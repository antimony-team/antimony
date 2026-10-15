package auth

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/coreos/go-oidc"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
)

const NativeUserID = "00000000-0000-0000-0000-00000000000"

type (
	Manager struct {
		jwtSecret []byte

		config *authConfig

		// Non-admin native accounts created at runtime via RegisterNativeUser, indexed by username
		// Disclaimer: This is only used for testing in development mode.
		nativeTestingAccounts map[string]nativeTestingAccount

		// authenticatedUsers holds the currently authenticated users, indexed by user ID
		authenticatedUsers map[string]*AuthenticatedUser

		// Guards nativeTestingAccounts and authenticatedUsers, which are written while requests read them
		usersMutex sync.Mutex
	}

	AuthenticatedUser struct {
		// The UUID of the user
		UserId string
		// List of the names of collections that the user has access to
		Collections []string
		IsAdmin     bool
	}

	authConfig struct {
		admin   adminAuthConfig
		openId  openIdAuthConfig
		desktop desktopAuthConfig
	}

	adminAuthConfig struct {
		enabled  bool
		username []byte
		password []byte
	}

	openIdAuthConfig struct {
		enabled     bool
		adminGroups []string
		secret      string

		oauth2Config oauth2.Config
		provider     oidc.Provider
	}

	desktopAuthConfig struct {
		enabled bool
		token   string
	}

	nativeTestingAccount struct {
		password string
		userId   string
	}
)

func CreateManager(antimonyConfig *config.AntimonyConfig) *Manager {
	authConfig := &authConfig{
		admin: adminAuthConfig{
			enabled:  slices.Contains(antimonyConfig.Auth.Methods, config.AuthMethods.Admin),
			username: ([]byte)(os.Getenv("SB_ADMIN_USERNAME")),
			password: ([]byte)(os.Getenv("SB_ADMIN_PASSWORD")),
		},
		openId: openIdAuthConfig{
			enabled:     slices.Contains(antimonyConfig.Auth.Methods, config.AuthMethods.OpenID),
			adminGroups: antimonyConfig.Auth.OpenIdAdminGroups,
			secret:      os.Getenv("SB_OIDC_SECRET"),
		},
		desktop: desktopAuthConfig{
			enabled: slices.Contains(antimonyConfig.Auth.Methods, config.AuthMethods.Desktop),
			token:   os.Getenv("SB_DESKTOP_TOKEN"),
		},
	}

	jwtSecret := os.Getenv("SB_JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = rand.Text()
	} else {
		log.Info("[AUTH] JWT secret was provided via env variable. JWT secret is not random.")
	}

	authManager := &Manager{
		authenticatedUsers:    make(map[string]*AuthenticatedUser),
		jwtSecret:             ([]byte)(jwtSecret),
		config:                authConfig,
		nativeTestingAccounts: make(map[string]nativeTestingAccount),
	}

	if authConfig.admin.enabled {
		if len(authConfig.admin.username) == 0 || len(authConfig.admin.password) == 0 {
			log.Fatal("[AUTH] Admin authentication is enabled but username or password have not been set!")
			return nil
		}

		authManager.registerNativeUser()
	}

	if authConfig.desktop.enabled {
		if authConfig.desktop.token == "" {
			log.Fatal("[AUTH] Desktop authentication is enabled but the token has not been set!")
			return nil
		}

		authManager.registerNativeUser()
	}

	if authConfig.openId.enabled {
		if authConfig.openId.secret == "" {
			log.Fatal("[AUTH] OpenID connect authentication is enabled but the secret has not been set!")
			return nil
		}

		if provider, err := oidc.NewProvider(context.TODO(), antimonyConfig.Auth.OpenIdIssuer); err == nil {
			authConfig.openId.provider = *provider
			authConfig.openId.oauth2Config = oauth2.Config{
				ClientID:     antimonyConfig.Auth.OpenIdClientID,
				ClientSecret: authConfig.openId.secret,
				RedirectURL:  fmt.Sprintf("%s/users/login/success", antimonyConfig.Auth.OpenIdRedirectHost),
				Endpoint:     provider.Endpoint(),
				Scopes:       []string{oidc.ScopeOpenID},
			}
		} else {
			log.Fatalf("[AUTH] Failed to connect to OpenID provider: %s", err.Error())
		}
	}

	return authManager
}

func (m *Manager) registerNativeUser() {
	m.authenticatedUsers[NativeUserID] = &AuthenticatedUser{
		UserId:      NativeUserID,
		IsAdmin:     true,
		Collections: make([]string, 0),
	}
}

// RegisterNativeUser adds a non-admin native account that can log in via the native login. The user has access to the
// given collections only. This is meant for development and testing setups.
//
// Disclaimer: This is only used for testing in development mode.
func (m *Manager) RegisterNativeUser(userId string, username string, password string, collections []string) error {
	if !m.config.admin.enabled {
		return utils.ErrAdminAuthDisabledError
	}

	// The new user can't have the same username as the admin user
	if username == "" || password == "" || username == string(m.config.admin.username) {
		return utils.ErrInvalidCredentials
	}

	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	if _, exists := m.nativeTestingAccounts[username]; exists {
		return utils.ErrInvalidCredentials
	}

	m.nativeTestingAccounts[username] = nativeTestingAccount{password: password, userId: userId}
	m.authenticatedUsers[userId] = &AuthenticatedUser{
		UserId:      userId,
		IsAdmin:     false,
		Collections: append(make([]string, 0, len(collections)), collections...),
	}

	return nil
}

func (m *Manager) RefreshAccessToken(authToken string) (string, error) {
	var (
		authUser       *AuthenticatedUser
		newAccessToken string
		err            error
	)

	if authUser, err = m.AuthenticateUser(authToken); err != nil {
		return "", err
	} else if newAccessToken, err = m.CreateAccessToken(*authUser); err != nil {
		return "", err
	} else {
		return newAccessToken, nil
	}
}

func (m *Manager) AuthenticatorMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		var (
			accessToken string
			user        *AuthenticatedUser
			err         error
		)

		accessToken, hasToken := strings.CutPrefix(ctx.GetHeader("Authorization"), "Bearer ")
		if !hasToken {
			accessToken, err = ctx.Cookie("accessToken")
		}

		if err != nil {
			ctx.JSON(utils.CreateErrorResponse(utils.ErrUnauthorized))
			ctx.Abort()
			return
		}

		if user, err = m.AuthenticateUser(accessToken); err != nil {
			ctx.JSON(utils.CreateErrorResponse(utils.ErrAccessTokenInvalid))
			ctx.Abort()
		} else {
			ctx.Set("authUser", *user)
			ctx.Next()
		}
	}
}

func (m *Manager) AuthenticateWithCode(
	authCode string,
	userSubToIdMapper func(userSub string, userProfile string) (string, error),
) (*AuthenticatedUser, error) {
	if !m.config.openId.enabled {
		return nil, utils.ErrOpenIDAuthDisabledError
	}

	ctx := context.TODO()
	token, err := m.config.openId.oauth2Config.Exchange(ctx, authCode)
	if err != nil {
		log.Errorf("[AUTH] OAuth token exchange failed: %s", err.Error())
		return nil, utils.ErrOpenIDError
	}

	info, err := m.config.openId.provider.UserInfo(ctx, m.config.openId.oauth2Config.TokenSource(ctx, token))
	if err != nil {
		log.Errorf("[AUTH] Failed to get oauth userinfo: %s", err.Error())
		return nil, utils.ErrOpenIDError
	}

	var claims struct {
		Sub     string   `json:"sub"`
		Groups  []string `json:"groups"`
		Profile string   `json:"email"`
	}

	err = info.Claims(&claims)
	if err != nil {
		log.Warn("[AUTH] Failed to parse claims from userinfo: %s", err.Error())
		return nil, utils.ErrOpenIDError
	}

	userSub := claims.Sub
	userGroups := claims.Groups
	userProfile := claims.Profile

	isAdmin := false
	for _, group := range m.config.openId.adminGroups {
		if slices.Contains(userGroups, group) {
			isAdmin = true
			break
		}
	}

	// Register authenticated user
	userId, err := userSubToIdMapper(userSub, userProfile)
	if err != nil {
		return nil, err
	}

	authenticatedUser := &AuthenticatedUser{
		UserId:      userId,
		IsAdmin:     isAdmin,
		Collections: userGroups,
	}
	m.usersMutex.Lock()
	m.authenticatedUsers[userId] = authenticatedUser
	m.usersMutex.Unlock()

	return authenticatedUser, nil
}
func (m *Manager) GetAuthCodeURL(stateToken string) (string, error) {
	if !m.config.openId.enabled {
		return "", utils.ErrOpenIDAuthDisabledError
	}

	return m.config.openId.oauth2Config.AuthCodeURL(stateToken), nil
}

func (m *Manager) LoginNative(username string, password string) (string, string, error) {
	if !m.config.admin.enabled {
		return "", "", utils.ErrAdminAuthDisabledError
	}

	var (
		authToken   string
		accessToken string
		err         error
	)

	userId := ""
	m.usersMutex.Lock()
	if subtle.ConstantTimeCompare([]byte(username), m.config.admin.username) == 1 &&
		subtle.ConstantTimeCompare([]byte(password), m.config.admin.password) == 1 {
		userId = NativeUserID
	} else if account, ok := m.nativeTestingAccounts[username]; ok &&
		subtle.ConstantTimeCompare([]byte(password), []byte(account.password)) == 1 {
		userId = account.userId
	}
	authUser := m.authenticatedUsers[userId]
	m.usersMutex.Unlock()

	if authUser == nil {
		return "", "", utils.ErrInvalidCredentials
	}

	if authToken, err = m.CreateAuthToken(userId); err != nil {
		return "", "", err
	} else if accessToken, err = m.CreateAccessToken(*authUser); err != nil {
		return "", "", err
	}

	return authToken, accessToken, nil
}

func (m *Manager) LoginDesktop(token string) (string, error) {
	if !m.config.desktop.enabled {
		return "", utils.ErrDesktopAuthDisabledError
	}

	if subtle.ConstantTimeCompare([]byte(token), []byte(m.config.desktop.token)) != 1 {
		return "", utils.ErrDesktopTokenInvalid
	}

	m.usersMutex.Lock()
	authUser := m.authenticatedUsers[NativeUserID]
	m.usersMutex.Unlock()

	if accessToken, err := m.CreateAccessToken(*authUser); err != nil {
		return "", err
	} else {
		return accessToken, nil
	}
}

func (m *Manager) AuthenticateUser(tokenString string) (*AuthenticatedUser, error) {
	if token, err := jwt.Parse(tokenString, m.tokenParser); err != nil {
		return nil, utils.ErrAccessTokenInvalid
	} else if tokenClaims, ok := token.Claims.(jwt.MapClaims); !ok {
		return nil, utils.ErrAccessTokenInvalid
	} else if userId, ok := tokenClaims["id"]; !ok {
		return nil, utils.ErrAccessTokenInvalid
	} else {
		userIdStr, ok := userId.(string)
		if !ok {
			return nil, utils.ErrAccessTokenInvalid
		}

		m.usersMutex.Lock()
		permissions, ok := m.authenticatedUsers[userIdStr]
		m.usersMutex.Unlock()

		if !ok {
			return nil, utils.ErrAccessTokenInvalid
		}

		return permissions, nil
	}
}

func (m *Manager) CreateAuthToken(userId string) (string, error) {
	sbToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":  userId,
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour * 720).Unix(),
	})

	return sbToken.SignedString(m.jwtSecret)
}

func (m *Manager) CreateAccessToken(authUser AuthenticatedUser) (string, error) {
	sbToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":      authUser.UserId,
		"isAdmin": authUser.IsAdmin,
		"nbf":     time.Now().Unix(),
		"exp":     time.Now().Add(time.Minute * 30).Unix(),
	})

	return sbToken.SignedString(m.jwtSecret)
}

func (m *Manager) tokenParser(token *jwt.Token) (interface{}, error) {
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, utils.ErrAccessTokenInvalid
	}

	return m.jwtSecret, nil
}

func (m *Manager) RegisterTestUser(user AuthenticatedUser) (string, error) {
	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	m.authenticatedUsers[user.UserId] = &user
	return user.UserId, nil
}

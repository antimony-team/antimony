package auth

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/coreos/go-oidc"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
)

const NativeUserID = "00000000-0000-0000-0000-00000000000"

type Manager struct {
	config         *config.AntimonyConfig
	oauth2Config   oauth2.Config
	provider       oidc.Provider
	oidcSecret     string
	jwtSecret      []byte
	adminGroups    []string
	authConfig     AuthConfig
	nativeUsername string
	nativePassword string

	// Additional native accounts created at runtime via RegisterNativeUser, indexed by username
	nativeAccounts map[string]nativeAccount

	// Currently authenticated users, indexed by user ID
	authenticatedUsers map[string]*AuthenticatedUser

	// Guards authenticatedUsers and nativeAccounts, which are written while requests read them
	usersMutex sync.Mutex
}

type nativeAccount struct {
	password string
	userId   string
}

type AuthenticatedUser struct {
	// The UUID of the user
	UserId string
	// List of the names of collections that the user has access to
	Collections []string
	IsAdmin     bool
}

type AuthConfig struct {
	OpenId OpenIdAuthConfig `json:"openId"`
	Native NativeAuthConfig `json:"native"`
}

type OpenIdAuthConfig struct {
	Enabled bool `json:"enabled"`
}

type NativeAuthConfig struct {
	Enabled    bool `json:"enabled"`
	AllowEmpty bool `json:"allowEmpty"`
}

func CreateManager(config *config.AntimonyConfig) *Manager {
	isOpenIdEnabled := config.Auth.EnableOpenID
	isNativeEnabled := config.Auth.EnableNative

	nativeUsername := os.Getenv("SB_NATIVE_USERNAME")
	nativePassword := os.Getenv("SB_NATIVE_PASSWORD")

	authConfig := AuthConfig{
		OpenId: OpenIdAuthConfig{
			Enabled: isOpenIdEnabled,
		},
		Native: NativeAuthConfig{
			Enabled:    isNativeEnabled,
			AllowEmpty: isNativeEnabled && (nativeUsername == "" || nativePassword == ""),
		},
	}

	envSecret := os.Getenv("SB_JWT_SECRET")
	if envSecret == "" {
		log.Info("[AUTH] JWT secret env variable is not provided. Generating a random secret.")
		envSecret = rand.Text()
	}

	authManager := &Manager{
		config:             config,
		authenticatedUsers: make(map[string]*AuthenticatedUser),
		adminGroups:        config.Auth.OpenIdAdminGroups,
		jwtSecret:          ([]byte)(envSecret),
		oidcSecret:         os.Getenv("SB_OIDC_SECRET"),
		authConfig:         authConfig,
		nativeUsername:     nativeUsername,
		nativePassword:     nativePassword,
		nativeAccounts:     make(map[string]nativeAccount),
	}

	if !isNativeEnabled && !isOpenIdEnabled {
		log.Warn("[AUTH] No authentication method is enabled. Server will be accessible to anyone.")
		authManager.CreateNativeUser()
	}

	if isNativeEnabled {
		if nativeUsername == "" || nativePassword == "" {
			log.Warn("[AUTH] Native authentication is enabled but username or password are empty!")
		} else {
			log.Info("Native authentication is enabled.", "username", nativeUsername)
		}
		authManager.CreateNativeUser()
	}

	if isOpenIdEnabled {
		provider, err := oidc.NewProvider(context.TODO(), config.Auth.OpenIdIssuer)
		if err != nil {
			log.Fatalf("[AUTH] Failed to connect to OpenID provider: %s", err.Error())
		} else {
			authManager.provider = *provider
			authManager.oauth2Config = oauth2.Config{
				ClientID:     config.Auth.OpenIdClientID,
				ClientSecret: authManager.oidcSecret,
				RedirectURL:  fmt.Sprintf("%s/users/login/success", config.Auth.OpenIdRedirectHost),
				Endpoint:     provider.Endpoint(),
				Scopes:       []string{oidc.ScopeOpenID},
			}
		}
	}

	return authManager
}

func (m *Manager) CreateNativeUser() {
	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	m.authenticatedUsers[NativeUserID] = &AuthenticatedUser{
		UserId:      NativeUserID,
		IsAdmin:     true,
		Collections: make([]string, 0),
	}
}

// RegisterNativeUser adds a non-admin native account that can log in via the native login. The user has access to the
// given collections only. This is meant for development and testing setups.
func (m *Manager) RegisterNativeUser(userId string, username string, password string, collections []string) error {
	if !m.authConfig.Native.Enabled {
		return utils.ErrNativeAuthDisabledError
	}

	if username == "" || password == "" || username == m.nativeUsername {
		return utils.ErrInvalidCredentials
	}

	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	if _, exists := m.nativeAccounts[username]; exists {
		return utils.ErrInvalidCredentials
	}

	m.nativeAccounts[username] = nativeAccount{password: password, userId: userId}
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

		// Allow everyone if no auth method is enabled
		if !m.authConfig.Native.Enabled && !m.authConfig.OpenId.Enabled {
			ctx.Set("authUser", AuthenticatedUser{
				UserId:      NativeUserID,
				IsAdmin:     true,
				Collections: make([]string, 0),
			})
			ctx.Next()
			return
		}

		accessToken, err = ctx.Cookie("accessToken")
		if err != nil {
			ctx.JSON(utils.CreateErrorResponse(utils.ErrUnauthorized))
			ctx.Abort()
			return
		}

		if user, err = m.AuthenticateUser(accessToken); err != nil {
			ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
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
	if !m.authConfig.OpenId.Enabled {
		return nil, utils.ErrOpenIDAuthDisabledError
	}

	ctx := context.TODO()
	token, err := m.oauth2Config.Exchange(ctx, authCode)
	if err != nil {
		log.Errorf("[AUTH] OAuth token exchange failed: %s", err.Error())
		return nil, utils.ErrOpenIDError
	}

	info, err := m.provider.UserInfo(ctx, m.oauth2Config.TokenSource(ctx, token))
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
	for _, group := range m.adminGroups {
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
	if !m.authConfig.OpenId.Enabled {
		return "", utils.ErrOpenIDAuthDisabledError
	}

	return m.oauth2Config.AuthCodeURL(stateToken), nil
}

func (m *Manager) LoginNative(username string, password string) (string, string, error) {
	var (
		authToken   string
		accessToken string
		err         error
	)

	if !m.authConfig.Native.Enabled {
		return "", "", utils.ErrNativeAuthDisabledError
	}

	userId := ""
	m.usersMutex.Lock()
	if username == m.nativeUsername && password == m.nativePassword {
		userId = NativeUserID
	} else if account, ok := m.nativeAccounts[username]; ok && password == account.password {
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
	} else {
		return authToken, accessToken, nil
	}
}

func (m *Manager) AuthenticateUser(tokenString string) (*AuthenticatedUser, error) {
	if token, err := jwt.Parse(tokenString, m.tokenParser); err != nil {
		return nil, utils.ErrTokenInvalid
	} else if tokenClaims, ok := token.Claims.(jwt.MapClaims); !ok {
		return nil, utils.ErrTokenInvalid
	} else if userId, ok := tokenClaims["id"]; !ok {
		return nil, utils.ErrTokenInvalid
	} else {
		userIdStr, ok := userId.(string)
		if !ok {
			return nil, utils.ErrTokenInvalid
		}

		m.usersMutex.Lock()
		permissions, ok := m.authenticatedUsers[userIdStr]
		m.usersMutex.Unlock()

		if !ok {
			return nil, utils.ErrTokenInvalid
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
		return nil, utils.ErrTokenInvalid
	}

	return m.jwtSecret, nil
}

func (m *Manager) RegisterTestUser(user AuthenticatedUser) (string, error) {
	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	m.authenticatedUsers[user.UserId] = &user
	return user.UserId, nil
}

func (m *Manager) GetAuthConfig() AuthConfig {
	return m.authConfig
}

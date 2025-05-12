package auth

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"context"
	"crypto/rand"
	"github.com/charmbracelet/log"
	"github.com/coreos/go-oidc"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
	"os"
	"slices"
	"time"
)

type (
	AuthManager interface {
		Init(config *config.AntimonyConfig)
		CreateAuthToken(userId string) (string, error)
		CreateAccessToken(authUser AuthenticatedUser) (string, error)
		AuthenticateUser(tokenString string) (*AuthenticatedUser, error)
		LoginNative(username string, password string) (string, string, error)
		GetAuthCodeURL(stateToken string) string
		AuthenticateWithCode(authCode string, userSubToIdMapper func(userSub string, userProfile string) (string, error)) (*AuthenticatedUser, error)
		AuthenticatorMiddleware() gin.HandlerFunc
		RefreshAccessToken(authToken string) (string, error)
		RegisterTestUser(authUser AuthenticatedUser) (string, error)
	}

	authManager struct {
		config             *config.AntimonyConfig
		authenticatedUsers map[string]*AuthenticatedUser
		oauth2Config       oauth2.Config
		provider           oidc.Provider
		oidcSecret         string
		jwtSecret          []byte
		adminGroups        []string
		isNativeEnabled    bool
		nativeUsername     string
		nativePassword     string
	}

	AuthenticatedUser struct {
		// The UUID of the user
		UserId string
		// List of the names of collections that the user has access to
		Collections []string
		IsAdmin     bool
	}
)

const NativeUserID = "00000000-0000-0000-0000-00000000000"

func CreateAuthManager(config *config.AntimonyConfig) AuthManager {
	isNativeEnabled := config.Auth.EnableNativeAdmin
	nativeUsername := os.Getenv("SB_NATIVE_USERNAME")
	nativePassword := os.Getenv("SB_NATIVE_PASSWORD")

	if isNativeEnabled && (nativeUsername == "" || nativePassword == "") {
		log.Warn("Native admin is enabled but username or password is empty!")
	}

	authManager := &authManager{
		config:             config,
		authenticatedUsers: make(map[string]*AuthenticatedUser),
		adminGroups:        config.Auth.OpenIdAdminGroups,
		jwtSecret:          ([]byte)(rand.Text()),
		oidcSecret:         os.Getenv("SB_OIDC_SECRET"),
		isNativeEnabled:    isNativeEnabled,
		nativeUsername:     nativeUsername,
		nativePassword:     nativePassword,
	}

	authManager.Init(config)

	return authManager
}

func (m *authManager) Init(config *config.AntimonyConfig) {
	if config.Auth.EnableNativeAdmin && config.Auth.OpenIdIssuer == "" {
		// Only use native, skip OIDC setup
		return
	}
	provider, err := oidc.NewProvider(context.TODO(), config.Auth.OpenIdIssuer)
	if err != nil {
		log.Fatalf("Failed to connect to OpenID provider: %s", err.Error())
		os.Exit(1)
	}

	m.provider = *provider
	m.oauth2Config = oauth2.Config{
		ClientID:     config.Auth.OpenIdClientId,
		ClientSecret: m.oidcSecret,
		RedirectURL:  "http://localhost:3000/users/login/success",
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID},
	}

	if m.isNativeEnabled {
		m.authenticatedUsers[NativeUserID] = &AuthenticatedUser{
			UserId:      NativeUserID,
			IsAdmin:     true,
			Collections: make([]string, 0),
		}
	}
}

func (m *authManager) RefreshAccessToken(authToken string) (string, error) {
	if authUser, err := m.AuthenticateUser(authToken); err != nil {
		return "", err
	} else if newAccessToken, err := m.CreateAccessToken(*authUser); err != nil {
		return "", err
	} else {
		return newAccessToken, nil
	}
}

func (m *authManager) AuthenticatorMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		accessToken, err := ctx.Cookie("accessToken")
		if err != nil {
			ctx.JSON(utils.CreateErrorResponse(utils.ErrorUnauthorized))
			ctx.Abort()
			return
		}

		if user, err := m.AuthenticateUser(accessToken); err != nil {
			ctx.JSON(utils.CreateErrorResponse(utils.ErrorTokenInvalid))
			ctx.Abort()
			return
		} else {
			ctx.Set("authUser", *user)
			ctx.Next()
		}
	}
}

func (m *authManager) AuthenticateWithCode(authCode string, userSubToIdMapper func(userSub string, userProfile string) (string, error)) (*AuthenticatedUser, error) {
	ctx := context.TODO()
	token, err := m.oauth2Config.Exchange(ctx, authCode)
	if err != nil {
		log.Errorf("[AUTH] OAuth token exchange failed: %s", err.Error())
		return nil, utils.ErrorOpenIDError
	}

	info, err := m.provider.UserInfo(ctx, m.oauth2Config.TokenSource(ctx, token))
	if err != nil {
		log.Errorf("[AUTH] Failed to get oauth userinfo: %s", err.Error())
		return nil, utils.ErrorOpenIDError
	}

	var claims struct {
		Sub     string   `json:"sub"`
		Groups  []string `json:"groups"`
		Profile string   `json:"email"`
	}

	err = info.Claims(&claims)
	if err != nil {
		log.Warn("[AUTH] Failed to parse claims from userinfo: %s", err.Error())
		return nil, utils.ErrorOpenIDError
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
	m.authenticatedUsers[userId] = authenticatedUser

	return authenticatedUser, nil
}
func (m *authManager) GetAuthCodeURL(stateToken string) string {
	return m.oauth2Config.AuthCodeURL(stateToken)
}

func (m *authManager) LoginNative(username string, password string) (string, string, error) {
	if m.isNativeEnabled && username == m.nativeUsername && password == m.nativePassword {
		authUser := m.authenticatedUsers[NativeUserID]
		if authToken, err := m.CreateAuthToken(NativeUserID); err != nil {
			return "", "", err
		} else if accessToken, err := m.CreateAccessToken(*authUser); err != nil {
			return "", "", err
		} else {
			return authToken, accessToken, nil
		}
	}
	return "", "", utils.ErrorInvalidCredentials
}

func (m *authManager) AuthenticateUser(tokenString string) (*AuthenticatedUser, error) {
	if token, err := jwt.Parse(tokenString, m.tokenParser); err != nil {
		return nil, utils.ErrorTokenInvalid
	} else if tokenClaims, ok := token.Claims.(jwt.MapClaims); !ok {
		return nil, utils.ErrorTokenInvalid
	} else if userId, ok := tokenClaims["id"]; !ok {
		return nil, utils.ErrorTokenInvalid
	} else if permissions, ok := m.authenticatedUsers[userId.(string)]; !ok {
		return nil, utils.ErrorTokenInvalid
	} else {
		return permissions, nil
	}
}

func (m *authManager) CreateAuthToken(userId string) (string, error) {
	sbToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":  userId,
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour * 720).Unix(),
	})

	return sbToken.SignedString(m.jwtSecret)
}

func (m *authManager) CreateAccessToken(authUser AuthenticatedUser) (string, error) {
	sbToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":      authUser.UserId,
		"isAdmin": authUser.IsAdmin,
		"nbf":     time.Now().Unix(),
		"exp":     time.Now().Add(time.Second * 20).Unix(),
	})

	return sbToken.SignedString(m.jwtSecret)
}

func (m *authManager) tokenParser(token *jwt.Token) (interface{}, error) {
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, utils.ErrorTokenInvalid
	}

	return m.jwtSecret, nil
}

func (m *authManager) RegisterTestUser(user AuthenticatedUser) (string, error) {
	m.authenticatedUsers[user.UserId] = &user
	return user.UserId, nil
}

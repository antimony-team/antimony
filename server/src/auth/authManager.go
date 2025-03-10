package auth

import (
	"antimonyBackend/src/config"
	"antimonyBackend/src/utils"
	"context"
	"crypto/rand"
	"github.com/charmbracelet/log"
	"github.com/coreos/go-oidc"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
	"os"
	"slices"
	"strings"
)

type (
	AuthManager interface {
		Init(config *config.AntimonyConfig)
		CreateToken(userId string) (string, error)
		LoginNative(username string, password string) (string, error)
		GetAuthCodeURL(stateToken string) string
		AuthenticateWithCode(authCode string, userSubToIdMapper func(userSub string, userProfile string) string) (*AuthenticatedUser, error)
		AuthenticatorMiddleware() gin.HandlerFunc
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
	provider, err := oidc.NewProvider(context.TODO(), config.Auth.OpenIdIssuer)
	if err != nil {
		log.Fatalf("Failed to connect to Sub provider: %s", err.Error())
		os.Exit(1)
	}

	m.provider = *provider
	m.oauth2Config = oauth2.Config{
		ClientID:     config.Auth.OpenIdClientId,
		ClientSecret: m.oidcSecret,
		RedirectURL:  "http://localhost:3000/users/login/success",
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "openid"},
	}

	if m.isNativeEnabled {
		m.authenticatedUsers[NativeUserID] = &AuthenticatedUser{
			UserId:      NativeUserID,
			IsAdmin:     true,
			Collections: make([]string, 0),
		}
	}
}

func (m *authManager) AuthenticatorMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		header := strings.Split(ctx.GetHeader("Authorization"), " ")
		if len(header) < 2 {
			log.Errorf("Failed to get auth header")
			ctx.JSON(utils.ErrorResponse(utils.ErrorUnauthorized))
			ctx.Abort()
			return
		}

		if user, err := m.authenticate(header[1]); err != nil {
			log.Errorf("Failed to authenticate: %s", err.Error())
			ctx.JSON(utils.ErrorResponse(utils.ErrorUnauthorized))
			ctx.Abort()
			return

		} else {
			ctx.Set("authUser", *user)
			ctx.Next()
		}
	}
}

func (m *authManager) AuthenticateWithCode(authCode string, userSubToIdMapper func(userSub string, userProfile string) string) (*AuthenticatedUser, error) {
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
		Profile string   `json:"profile"`
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
	userId := userSubToIdMapper(userSub, userProfile)
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

func (m *authManager) LoginNative(username string, password string) (string, error) {
	if m.isNativeEnabled && username == m.nativeUsername && password == m.nativePassword {
		return m.CreateToken(NativeUserID)
	}

	return "", utils.ErrorInvalidCredentials
}

func (m *authManager) authenticate(tokenString string) (*AuthenticatedUser, error) {
	if token, err := jwt.Parse(tokenString, m.tokenParser); err != nil {
		log.Errorf("[AUTH] Failed to parse token: %s", err.Error())
		return nil, utils.ErrorInvalidToken
	} else if tokenClaims, ok := token.Claims.(jwt.MapClaims); !ok {
		log.Errorf("[AUTH] Failed to parse token claims")
		return nil, utils.ErrorInvalidToken
	} else if userSub, ok := tokenClaims["id"]; !ok {
		log.Errorf("[AUTH] Failed to get id from token")
		return nil, utils.ErrorInvalidToken
	} else if permissions, ok := m.authenticatedUsers[userSub.(string)]; !ok {
		log.Errorf("[AUTH] Failed to get user from id")
		return nil, utils.ErrorInvalidToken
	} else {
		return permissions, nil
	}
}

func (m *authManager) CreateToken(userId string) (string, error) {
	sbToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id": userId,
	})

	return sbToken.SignedString(m.jwtSecret)
}

func (m *authManager) tokenParser(token *jwt.Token) (interface{}, error) {
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, utils.ErrorInvalidToken
	}

	return m.jwtSecret, nil
}

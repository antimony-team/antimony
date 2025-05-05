package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"errors"
	"github.com/gin-gonic/gin"
)

type MockAuthManager struct {
	User auth.AuthenticatedUser
}

func (m MockAuthManager) Init(config *config.AntimonyConfig) {}

func (m MockAuthManager) CreateAuthToken(userId string) (string, error) {
	return "mock-auth-token", nil
}

func (m MockAuthManager) CreateAccessToken(authUser auth.AuthenticatedUser) (string, error) {
	return "mock-access-token", nil
}

func (m MockAuthManager) AuthenticateUser(tokenString string) (*auth.AuthenticatedUser, error) {
	return &auth.AuthenticatedUser{
		IsAdmin:     true,
		UserId:      "test-user-id",
		Collections: []string{"hidden-group"},
	}, nil
}

func (m MockAuthManager) LoginNative(username string, password string) (string, string, error) {
	return "mock-token", "mock-access", nil
}

func (m MockAuthManager) GetAuthCodeURL(stateToken string) string {
	return "https://mock-auth"
}

func (m MockAuthManager) AuthenticateWithCode(authCode string, mapper func(string, string) (string, error)) (*auth.AuthenticatedUser, error) {
	userId, err := mapper("mock-sub", "mock-profile")
	if err != nil {
		return nil, err
	}
	return &auth.AuthenticatedUser{
		UserId:      userId,
		IsAdmin:     true,
		Collections: []string{"mock-group"},
	}, nil
}

func (m MockAuthManager) RefreshAccessToken(authToken string) (string, error) {
	if authToken == "" {
		return "", errors.New("token missing")
	}
	return "refreshed-token", nil
}

func (m MockAuthManager) AuthenticatorMiddleware() gin.HandlerFunc {
	return m.GetMiddleware()
}

func (m MockAuthManager) GetMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("authUser", m.User)
		c.Next()
	}
}

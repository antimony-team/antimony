package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"encoding/json"
	"github.com/stretchr/testify/assert"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// === POST === login
func TestLogin_Success(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	body := `{"username":"testuser","password":"testpass"}`
	req := httptest.NewRequest("POST", "/users/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	cookies := resp.Result().Cookies()
	var hasAccessToken, hasAuthToken bool
	for _, c := range cookies {
		if c.Name == "accessToken" {
			hasAccessToken = true
		}
		if c.Name == "authToken" {
			hasAuthToken = true
		}
	}
	assert.True(t, hasAccessToken, "accessToken cookie should be set")
	assert.True(t, hasAuthToken, "authToken cookie should be set")
}

func TestLogin_InvalidJSON(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	body := `{"username": "testuser"` // malformed JSON
	req := httptest.NewRequest("POST", "/users/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	var response utils.ErrorResponse
	err := json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, 1001, response.Code)
}

func TestLogin_MissingFields(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	body := `{}` // missing both username and password
	req := httptest.NewRequest("POST", "/users/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	var response utils.ErrorResponse
	err := json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, 1001, response.Code)
}

func TestLogin_WrongCredentials(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	body := `{"username":"wronguser","password":"wrongpass"}`
	req := httptest.NewRequest("POST", "/users/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	var response utils.ErrorResponse
	err := json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, 1001, response.Code)
}

// === Get === logout
func TestLogout_WithCookies(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/logout", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "fake-token"})
	req.AddCookie(&http.Cookie{Name: "authToken", Value: "fake-token"})
	req.AddCookie(&http.Cookie{Name: "authOidc", Value: "true"})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var cleared []string
	for _, c := range resp.Result().Cookies() {
		if c.MaxAge == -1 || c.Expires.Before(time.Now()) {
			cleared = append(cleared, c.Name)
		}
	}

	assert.Contains(t, cleared, "accessToken")
	assert.Contains(t, cleared, "authToken")
	assert.Contains(t, cleared, "authOidc")
}

func TestLogout_WithoutCookies(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/logout", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

// === GET === login/check
func TestLoginCheck_ValidToken(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	req := httptest.NewRequest("GET", "/users/login/check", nil)
	req.AddCookie(&http.Cookie{Name: "Authorization", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestLoginCheck_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/login/check", nil)
	req.AddCookie(&http.Cookie{Name: "Authorization", Value: "invalid-token"})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestLoginCheck_MissingToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/login/check", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

// === GET === login/openid
func TestLoginOIDC_Redirect(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/login/openid", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	//Redirected
	assert.Equal(t, http.StatusFound, resp.Code)
}

//=== GET === login/success
//not testable

// === GET === login/refresh
func TestRefreshToken_Success(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	user := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	authToken, _ := authManager.CreateAuthToken(user.UserId)

	req := httptest.NewRequest("GET", "/users/login/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "authToken", Value: authToken})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var result utils.OkResponse[string]
	err := json.Unmarshal(resp.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.NotEmpty(t, result.Payload)
}

func TestRefreshToken_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/login/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "authToken", Value: "invalid-token"})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestRefreshToken_MissingToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/users/login/refresh", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

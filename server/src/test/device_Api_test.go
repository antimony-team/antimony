package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/device"
	"antimonyBackend/utils"
	"encoding/json"
	"github.com/stretchr/testify/assert"
	"net/http"
	"net/http/httptest"
	"testing"
)

// === GET ===
func TestGetDevices_Success(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{},
	})
	assert.NoError(t, err)

	req, _ := http.NewRequest("GET", "/devices", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var response utils.OkResponse[[]device.DeviceConfig]
	err = json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.NotEmpty(t, response.Payload, "Expected at least one device config in payload")
}

func TestGetDevices_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("GET", "/devices", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestGetDevices_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("GET", "/devices", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "broken.token.value"})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

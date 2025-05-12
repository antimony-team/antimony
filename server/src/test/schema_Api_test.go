package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"encoding/json"
	"github.com/stretchr/testify/assert"
	"net/http"
	"net/http/httptest"
	"testing"
)

// === GET ===
func TestGetClabSchema_Success(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{},
	})
	assert.NoError(t, err)

	req := httptest.NewRequest("GET", "/clab-schema", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var result utils.OkResponse[any]
	err = json.Unmarshal(resp.Body.Bytes(), &result)
	assert.NoError(t, err)

	assert.NotNil(t, result.Payload)
}

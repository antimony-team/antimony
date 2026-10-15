package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/domain/user"
	"antimonyBackend/transport"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * POST /users/login/desktop
 */

func withDesktopAuth() HarnessOption {
	return WithAuthMethods(config.AuthMethods.Admin, config.AuthMethods.Desktop)
}

func TestLoginDesktop_SuccessReturnsAUsableAccessToken(t *testing.T) {
	h := NewHarness(t, withDesktopAuth())

	response := h.POST("/users/login/desktop", user.DesktopTokenIn{Token: testDesktopToken}, "")

	var accessToken string
	response.RequireOk(&accessToken)
	require.NotEmpty(t, accessToken)

	// The desktop app keeps the token itself, so no cookies are set.
	assert.Empty(t, response.Recorder.Result().Cookies())

	claims := parseClaims(t, accessToken)
	assert.Equal(t, auth.NativeUserID, claims["id"], "the desktop login signs in as the admin user")
	assert.Equal(t, true, claims["isAdmin"])

	var collections []transport.CollectionOut
	h.WithHeaders(http.MethodGet, "/collections", bearer(accessToken)).RequireOk(&collections)
	assert.Len(t, collections, 5, "the admin sees every collection")
}

func TestLoginDesktop_WorksWithoutAdminAuth(t *testing.T) {
	h := NewHarness(t, WithAuthMethods(config.AuthMethods.Desktop))

	var accessToken string
	h.POST("/users/login/desktop", user.DesktopTokenIn{Token: testDesktopToken}, "").RequireOk(&accessToken)

	h.WithHeaders(http.MethodGet, "/collections", bearer(accessToken)).RequireStatus(http.StatusOK)

	// The admin login stays disabled even though the admin user exists for the desktop login.
	h.POST("/users/login/native", user.CredentialsIn{
		Username: "testuser",
		Password: "testpass",
	}, "").RequireError(http.StatusUnauthorized, 401)
}

func TestLoginDesktop_WrongTokenIsForbidden(t *testing.T) {
	h := NewHarness(t, withDesktopAuth())

	for name, token := range map[string]string{
		"wrong token":  "not-the-desktop-token",
		"token prefix": testDesktopToken[:len(testDesktopToken)-1],
		"token suffix": testDesktopToken + "x",
	} {
		t.Run(name, func(t *testing.T) {
			h.POST("/users/login/desktop", user.DesktopTokenIn{Token: token}, "").
				RequireError(http.StatusForbidden, 403)
		})
	}
}

func TestLoginDesktop_DisabledReturnsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	h.POST("/users/login/desktop", user.DesktopTokenIn{Token: testDesktopToken}, "").
		RequireError(http.StatusUnauthorized, 401)
}

func TestLoginDesktop_MalformedBodyIsRejected(t *testing.T) {
	h := NewHarness(t, withDesktopAuth())

	for name, body := range map[string]string{
		"malformed json": `{"token":`,
		"empty body":     "",
		"missing token":  `{}`,
		"empty token":    `{"token":""}`,
		"wrong type":     `{"token":12345}`,
	} {
		t.Run(name, func(t *testing.T) {
			h.RawBody(http.MethodPost, "/users/login/desktop", body, "").
				RequireError(http.StatusBadRequest, 1001)
		})
	}
}

func TestLoginDesktop_TokenWorksForSockets(t *testing.T) {
	h := NewHarness(t, withDesktopAuth())

	var accessToken string
	h.POST("/users/login/desktop", user.DesktopTokenIn{Token: testDesktopToken}, "").RequireOk(&accessToken)

	_, err := h.TryDial("/cmd", accessToken)
	require.NoError(t, err)
}

/*
 * CORS for the desktop app
 */

func TestCors_DesktopAppCanCallTheApi(t *testing.T) {
	h := NewHarness(t, withDesktopAuth())

	preflight := h.WithHeaders(http.MethodOptions, "/labs", map[string]string{
		"Origin":                         "null",
		"Access-Control-Request-Method":  http.MethodGet,
		"Access-Control-Request-Headers": "authorization",
	})
	preflight.RequireStatus(http.StatusNoContent)
	assert.Equal(t, "null", preflight.Recorder.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, preflight.Recorder.Header().Get("Access-Control-Allow-Headers"), "Authorization")

	headers := bearer(h.Seed.Admin.Token)
	headers["Origin"] = "null"

	response := h.WithHeaders(http.MethodGet, "/labs", headers)
	response.RequireStatus(http.StatusOK)
	assert.Equal(t, "null", response.Recorder.Header().Get("Access-Control-Allow-Origin"))
}

func TestCors_NoHeadersWithoutDesktopAuth(t *testing.T) {
	h := NewHarness(t)

	headers := bearer(h.Seed.Admin.Token)
	headers["Origin"] = "null"

	response := h.WithHeaders(http.MethodGet, "/labs", headers)
	response.RequireStatus(http.StatusOK)
	assert.Empty(t, response.Recorder.Header().Get("Access-Control-Allow-Origin"))
}

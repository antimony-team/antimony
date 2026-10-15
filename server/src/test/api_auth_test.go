package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/transport"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testJWTSecret matches the SB_JWT_SECRET the harness exports.
const testJWTSecret = "antimony-test-secret"

// protectedRoutes is every route group behind auth.AuthenticatorMiddleware.
var protectedRoutes = []struct {
	name   string
	method string
	path   string
}{
	{"collections", http.MethodGet, "/collections"},
	{"devices", http.MethodGet, "/devices"},
	{"topologies", http.MethodGet, "/topologies"},
	{"labs", http.MethodGet, "/labs"},
	{"server-config", http.MethodGet, "/server-config"},
}

func TestAuthMiddleware_MissingCookieIsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	for _, route := range protectedRoutes {
		t.Run(route.name, func(t *testing.T) {
			response := h.GET(route.path, "")
			errorResponse := response.RequireError(http.StatusUnauthorized, 401)

			assert.Contains(t, errorResponse.Message, "unauthorized")
		})
	}
}

func TestAuthMiddleware_MalformedTokenIsRejected(t *testing.T) {
	h := NewHarness(t)

	for _, route := range protectedRoutes {
		t.Run(route.name, func(t *testing.T) {
			h.GET(route.path, "this-is-not-a-jwt").RequireError(498, 498)
		})
	}
}

func TestAuthMiddleware_EmptyTokenCookieIsInvalidRatherThanMissing(t *testing.T) {
	h := NewHarness(t)

	// A present-but-empty cookie is not the same as a missing one: gin hands back the empty string
	// without an error, so the request reaches the token parser and fails as an invalid token (498)
	// rather than as an unauthorized one (401).
	response := h.WithCookies(http.MethodGet, "/collections", &http.Cookie{Name: "accessToken", Value: ""})
	response.RequireError(498, 498)
}

func TestAuthMiddleware_TokenSignedWithWrongSecretIsRejected(t *testing.T) {
	h := NewHarness(t)

	token := signToken(t, "wrong-secret", jwt.MapClaims{
		"id":  h.Seed.Admin.ID(),
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	h.GET("/collections", token).RequireError(498, 498)
}

func TestAuthMiddleware_TokenForUnregisteredUserIsRejected(t *testing.T) {
	h := NewHarness(t)

	// Correctly signed, but the auth manager has never heard of this user, so the permission
	// lookup fails even though the signature verifies.
	h.GET("/collections", h.UnregisteredToken("ghost-user")).RequireError(498, 498)
}

func TestAuthMiddleware_ExpiredTokenIsRejected(t *testing.T) {
	h := NewHarness(t)

	token := signToken(t, testJWTSecret, jwt.MapClaims{
		"id":  h.Seed.Admin.ID(),
		"nbf": time.Now().Add(-2 * time.Hour).Unix(),
		"exp": time.Now().Add(-1 * time.Hour).Unix(),
	})

	h.GET("/collections", token).RequireError(498, 498)
}

func TestAuthMiddleware_NotYetValidTokenIsRejected(t *testing.T) {
	h := NewHarness(t)

	token := signToken(t, testJWTSecret, jwt.MapClaims{
		"id":  h.Seed.Admin.ID(),
		"nbf": time.Now().Add(1 * time.Hour).Unix(),
		"exp": time.Now().Add(2 * time.Hour).Unix(),
	})

	h.GET("/collections", token).RequireError(498, 498)
}

func TestAuthMiddleware_TokenWithoutIdClaimIsRejected(t *testing.T) {
	h := NewHarness(t)

	token := signToken(t, testJWTSecret, jwt.MapClaims{
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	h.GET("/collections", token).RequireError(498, 498)
}

func TestAuthMiddleware_TokenWithNonStringIdIsRejected(t *testing.T) {
	h := NewHarness(t)

	token := signToken(t, testJWTSecret, jwt.MapClaims{
		"id":  12345,
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	h.GET("/collections", token).RequireError(498, 498)
}

func TestAuthMiddleware_ValidTokenIsAccepted(t *testing.T) {
	h := NewHarness(t)

	for _, route := range protectedRoutes {
		t.Run(route.name, func(t *testing.T) {
			h.GET(route.path, h.Seed.Admin.Token).RequireStatus(http.StatusOK)
		})
	}
}

func TestAuthMiddleware_AllAuthDisabledStillRequiresAToken(t *testing.T) {
	h := NewHarness(t, WithAuthMethods())

	// Disabling every login method doesn't open the API up, anonymous requests are still refused.
	h.GET("/collections", "").RequireError(http.StatusUnauthorized, 401)
}

/*
 * Authorization: Bearer header
 */

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func TestAuthMiddleware_BearerTokenIsAcceptedWithoutCookie(t *testing.T) {
	h := NewHarness(t)

	for _, route := range protectedRoutes {
		t.Run(route.name, func(t *testing.T) {
			h.WithHeaders(route.method, route.path, bearer(h.Seed.Admin.Token)).RequireStatus(http.StatusOK)
		})
	}
}

func TestAuthMiddleware_BearerTokenCarriesTheUsersPermissions(t *testing.T) {
	h := NewHarness(t)

	var collections []transport.CollectionOut
	h.WithHeaders(http.MethodGet, "/collections", bearer(h.Seed.Member.Token)).RequireOk(&collections)

	assert.Len(t, collections, 4, "the member must not see the hidden collection")
}

func TestAuthMiddleware_InvalidBearerTokenIsRejected(t *testing.T) {
	h := NewHarness(t)

	for name, token := range map[string]string{
		"malformed":         "this-is-not-a-jwt",
		"empty":             "",
		"unregistered user": h.UnregisteredToken("ghost-user"),
	} {
		t.Run(name, func(t *testing.T) {
			h.WithHeaders(http.MethodGet, "/collections", bearer(token)).RequireError(498, 498)
		})
	}
}

func TestAuthMiddleware_BearerHeaderTakesPrecedenceOverCookie(t *testing.T) {
	h := NewHarness(t)

	request := httptest.NewRequest(http.MethodGet, "/collections", nil)
	request.Header.Set("Authorization", "Bearer this-is-not-a-jwt")
	request.AddCookie(&http.Cookie{Name: "accessToken", Value: h.Seed.Admin.Token})

	recorder := httptest.NewRecorder()
	h.Engine.ServeHTTP(recorder, request)

	assert.Equal(t, 498, recorder.Code)
}

func TestAuthMiddleware_NonBearerAuthorizationFallsBackToCookie(t *testing.T) {
	h := NewHarness(t)

	// Any other scheme isn't a bearer token, so the middleware looks for the cookie, which is missing here.
	h.WithHeaders(http.MethodGet, "/collections", map[string]string{
		"Authorization": "Basic dGVzdHVzZXI6dGVzdHBhc3M=",
	}).RequireError(http.StatusUnauthorized, 401)
}

func TestAuthMiddleware_PublicRoutesNeedNoToken(t *testing.T) {
	h := NewHarness(t)

	t.Run("clab schema", func(t *testing.T) {
		h.GET("/clab-schema", "").RequireStatus(http.StatusOK)
	})

	t.Run("auth config", func(t *testing.T) {
		h.GET("/users/login/auth-config", "").RequireStatus(http.StatusOK)
	})

	t.Run("logout", func(t *testing.T) {
		h.POST("/users/logout", nil, "").RequireStatus(http.StatusOK)
	})
}

func TestAuthMiddleware_AdminSeesResourcesOutsideItsCollections(t *testing.T) {
	h := NewHarness(t)

	// AdminBare has no collection memberships at all; the IsAdmin flag alone must be enough.
	var collections []transport.CollectionOut
	h.GET("/collections", h.Seed.AdminBare.Token).RequireOk(&collections)

	assert.Len(t, collections, 5)

	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.AdminBare.Token).RequireOk(&topologies)

	assert.Len(t, topologies, 4)
}

func TestAuthManager_AccessTokenCarriesAdminFlag(t *testing.T) {
	h := NewHarness(t)

	token, err := h.Auth.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      h.Seed.Member.ID(),
		IsAdmin:     false,
		Collections: []string{CollectionPublicBoth},
	})
	require.NoError(t, err)

	claims := parseClaims(t, token)

	assert.Equal(t, h.Seed.Member.ID(), claims["id"])
	assert.Equal(t, false, claims["isAdmin"])
	assert.NotNil(t, claims["exp"])
	assert.NotNil(t, claims["nbf"])
}

func TestAuthManager_AuthTokenOutlivesAccessToken(t *testing.T) {
	h := NewHarness(t)

	accessClaims := parseClaims(t, h.Seed.Admin.Token)
	refreshClaims := parseClaims(t, h.RefreshToken(h.Seed.Admin.ID()))

	accessExp, ok := accessClaims["exp"].(float64)
	require.True(t, ok)

	refreshExp, ok := refreshClaims["exp"].(float64)
	require.True(t, ok)

	assert.Greaterf(
		t, refreshExp, accessExp,
		"the auth token must outlive the access token so it can be used to refresh it",
	)
}

/*
 * Helpers.
 */

func signToken(t *testing.T, secret string, claims map[string]any) string {
	t.Helper()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims(claims)).
		SignedString([]byte(secret))
	require.NoError(t, err)

	return token
}

func parseClaims(t *testing.T, token string) jwt.MapClaims {
	t.Helper()

	parsed, err := jwt.Parse(token, func(*jwt.Token) (any, error) {
		return []byte(testJWTSecret), nil
	})
	require.NoError(t, err)

	claims, ok := parsed.Claims.(jwt.MapClaims)
	require.True(t, ok)

	return claims
}

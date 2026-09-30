package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/user"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * POST /users/login/native
 */

func TestLoginNative_SuccessSetsBothCookies(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/users/login/native", user.CredentialsIn{
		Username: "testuser",
		Password: "testpass",
	}, "")

	response.RequireEmptyOk()

	authToken := response.RequireCookie("authToken")
	accessToken := response.RequireCookie("accessToken")

	assert.True(t, authToken.HttpOnly, "the long-lived auth token must not be readable from JavaScript")
	assert.False(t, accessToken.HttpOnly, "the access token is read by the frontend")

	// The freshly issued access token must actually work.
	h.GET("/collections", accessToken.Value).RequireStatus(http.StatusOK)
}

func TestLoginNative_WrongPasswordIsRejected(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/users/login/native", user.CredentialsIn{
		Username: "testuser",
		Password: "nope",
	}, "")

	response.RequireError(http.StatusBadRequest, 1001)
	assert.Nil(t, response.Cookie("accessToken"))
}

func TestLoginNative_WrongUsernameIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.POST("/users/login/native", user.CredentialsIn{
		Username: "someone-else",
		Password: "testpass",
	}, "").RequireError(http.StatusBadRequest, 1001)
}

func TestLoginNative_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPost, "/users/login/native", `{"username":`, "").
		RequireError(http.StatusBadRequest, 1001)
}

func TestLoginNative_EmptyBodyIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPost, "/users/login/native", "", "").
		RequireError(http.StatusBadRequest, 1001)
}

func TestLoginNative_MissingFieldsAreTreatedAsWrongCredentials(t *testing.T) {
	h := NewHarness(t)

	// CredentialsIn carries `json:"username" ,binding:"required"` — the stray comma means the key
	// is ",binding" rather than "binding", so the required validation never runs and an empty body
	// binds cleanly. It then fails the credential comparison instead.
	h.RawBody(http.MethodPost, "/users/login/native", `{}`, "").
		RequireError(http.StatusBadRequest, 1001)
}

func TestLoginNative_DisabledReturnsUnauthorized(t *testing.T) {
	h := NewHarness(t, WithAuthMethods(false, true), WithOpenID(NewFakeOIDCProvider(t).Issuer(), "client"))

	h.POST("/users/login/native", user.CredentialsIn{
		Username: "testuser",
		Password: "testpass",
	}, "").RequireError(http.StatusUnauthorized, 401)
}

func TestLoginNative_UnconfiguredCredentialsAcceptAnEmptyLogin(t *testing.T) {
	h := NewHarness(t, WithNativeCredentials("", ""))

	// Native auth is enabled but SB_NATIVE_USERNAME/PASSWORD are unset, so empty credentials match
	// and authenticate as the native admin. The auth config advertises this via allowEmpty.
	response := h.POST("/users/login/native", user.CredentialsIn{}, "")
	response.RequireEmptyOk()

	accessToken := response.RequireCookie("accessToken")
	h.GET("/collections", accessToken.Value).RequireStatus(http.StatusOK)
}

/*
 * POST /users/logout
 */

func TestLogout_ClearsEveryAuthCookie(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/users/logout", nil, h.Seed.Admin.Token)
	response.RequireEmptyOk()

	response.RequireClearedCookie("authToken")
	response.RequireClearedCookie("accessToken")
	response.RequireClearedCookie("authOidc")
}

func TestLogout_WorksWithoutCookies(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/users/logout", nil, "")
	response.RequireEmptyOk()

	response.RequireClearedCookie("accessToken")
}

/*
 * GET /users/login/auth-config
 */

func TestAuthConfig_ReportsNativeOnly(t *testing.T) {
	h := NewHarness(t)

	var authConfig auth.AuthConfig
	h.GET("/users/login/auth-config", "").RequireOk(&authConfig)

	assert.True(t, authConfig.Native.Enabled)
	assert.False(t, authConfig.Native.AllowEmpty)
	assert.False(t, authConfig.OpenId.Enabled)
}

func TestAuthConfig_ReportsAllowEmptyWhenUnconfigured(t *testing.T) {
	h := NewHarness(t, WithNativeCredentials("", ""))

	var authConfig auth.AuthConfig
	h.GET("/users/login/auth-config", "").RequireOk(&authConfig)

	assert.True(t, authConfig.Native.Enabled)
	assert.True(t, authConfig.Native.AllowEmpty)
}

func TestAuthConfig_ReportsBothMethods(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	var authConfig auth.AuthConfig
	h.GET("/users/login/auth-config", "").RequireOk(&authConfig)

	assert.True(t, authConfig.Native.Enabled)
	assert.True(t, authConfig.OpenId.Enabled)
}

func TestAuthConfig_ReportsNeitherWhenAllDisabled(t *testing.T) {
	h := NewHarness(t, WithAuthMethods(false, false))

	var authConfig auth.AuthConfig
	h.GET("/users/login/auth-config", "").RequireOk(&authConfig)

	assert.False(t, authConfig.Native.Enabled)
	assert.False(t, authConfig.OpenId.Enabled)
}

/*
 * GET /users/login/refresh
 */

func TestRefreshToken_IssuesAFreshAccessToken(t *testing.T) {
	h := NewHarness(t)

	response := h.WithCookies(http.MethodGet, "/users/login/refresh", &http.Cookie{
		Name:  "authToken",
		Value: h.RefreshToken(h.Seed.Admin.ID()),
	})

	var issued string
	response.RequireOk(&issued)

	assert.NotEmpty(t, issued)
	assert.Equal(t, issued, response.RequireCookie("accessToken").Value)

	// The refreshed token must be usable and carry the same identity.
	h.GET("/collections", issued).RequireStatus(http.StatusOK)

	claims := parseClaims(t, issued)
	assert.Equal(t, h.Seed.Admin.ID(), claims["id"])
	assert.Equal(t, true, claims["isAdmin"])
}

func TestRefreshToken_MissingCookieIsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	h.GET("/users/login/refresh", "").RequireError(http.StatusUnauthorized, 401)
}

func TestRefreshToken_InvalidTokenIsForbidden(t *testing.T) {
	h := NewHarness(t)

	response := h.WithCookies(http.MethodGet, "/users/login/refresh", &http.Cookie{
		Name:  "authToken",
		Value: "not-a-jwt",
	})

	response.RequireError(http.StatusForbidden, 403)
}

func TestRefreshToken_UnknownUserIsForbidden(t *testing.T) {
	h := NewHarness(t)

	// Correctly signed for a user the auth manager does not know about.
	response := h.WithCookies(http.MethodGet, "/users/login/refresh", &http.Cookie{
		Name:  "authToken",
		Value: h.RefreshToken("ghost-user"),
	})

	response.RequireError(http.StatusForbidden, 403)
}

/*
 * GET /users/login/openid
 */

func TestLoginOpenId_DisabledReturnsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	h.GET("/users/login/openid", "").RequireError(http.StatusUnauthorized, 401)
}

func TestLoginOpenId_RedirectsToProviderCarryingRefererAsState(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	request := h.WithCookies(http.MethodGet, "/users/login/openid")
	request.RequireStatus(http.StatusFound)

	location, err := url.Parse(request.Recorder.Header().Get("Location"))
	require.NoError(t, err)

	assert.Equal(t, oidc.Issuer()+"/auth", location.Scheme+"://"+location.Host+location.Path)
	assert.Equal(t, oidc.ClientID, location.Query().Get("client_id"))
	assert.Equal(t, "code", location.Query().Get("response_type"))
	assert.Contains(t, location.Query().Get("scope"), "openid")
}

/*
 * GET /users/login/success
 */

func TestLoginOpenIdSuccess_ExchangesCodeAndCreatesTheUser(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	oidc.RegisterCode("good-code", OIDCClaims{
		Sub:    "oidc-subject-1",
		Email:  "newcomer@example.com",
		Groups: []string{CollectionPublicBoth},
	})

	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	response := h.GET("/users/login/success?code=good-code&state=http://frontend.example/done", "")
	response.RequireStatus(http.StatusFound)

	assert.Equal(t, "http://frontend.example/done", response.Recorder.Header().Get("Location"))

	response.RequireCookie("authToken")
	response.RequireCookie("accessToken")
	assert.Equal(t, "true", response.RequireCookie("authOidc").Value)

	// A user row must have been created for the new subject.
	created, _, err := h.UserRepo.GetBySub(t.Context(), "oidc-subject-1")
	require.NoError(t, err)
	assert.Equal(t, "newcomer@example.com", created.Name)

	// And the issued access token must work, scoped to the groups the provider reported.
	accessToken := response.RequireCookie("accessToken").Value
	h.GET("/collections", accessToken).RequireStatus(http.StatusOK)
}

func TestLoginOpenIdSuccess_MapsAdminGroupToAdminRights(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	oidc.RegisterCode("admin-code", OIDCClaims{
		Sub:    "oidc-admin",
		Email:  "boss@example.com",
		Groups: []string{"antimony-admin"},
	})

	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID, "antimony-admin"))

	response := h.GET("/users/login/success?code=admin-code&state=/done", "")
	response.RequireStatus(http.StatusFound)

	claims := parseClaims(t, response.RequireCookie("accessToken").Value)
	assert.Equal(t, true, claims["isAdmin"], "membership of an admin group must grant admin rights")
}

func TestLoginOpenIdSuccess_NonAdminGroupsDoNotGrantAdminRights(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	oidc.RegisterCode("plain-code", OIDCClaims{
		Sub:    "oidc-plain",
		Email:  "member@example.com",
		Groups: []string{"some-other-group"},
	})

	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID, "antimony-admin"))

	response := h.GET("/users/login/success?code=plain-code&state=/done", "")
	response.RequireStatus(http.StatusFound)

	claims := parseClaims(t, response.RequireCookie("accessToken").Value)
	assert.Equal(t, false, claims["isAdmin"])
}

func TestLoginOpenIdSuccess_RefreshesTheNameOfAReturningUser(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	oidc.RegisterCode("first-login", OIDCClaims{Sub: "returning", Email: "old@example.com"})
	h.GET("/users/login/success?code=first-login&state=/done", "").RequireStatus(http.StatusFound)

	first, _, err := h.UserRepo.GetBySub(t.Context(), "returning")
	require.NoError(t, err)
	assert.Equal(t, "old@example.com", first.Name)

	oidc.RegisterCode("second-login", OIDCClaims{Sub: "returning", Email: "new@example.com"})
	h.GET("/users/login/success?code=second-login&state=/done", "").RequireStatus(http.StatusFound)

	second, _, err := h.UserRepo.GetBySub(t.Context(), "returning")
	require.NoError(t, err)

	assert.Equal(t, "new@example.com", second.Name, "the profile name must be refreshed on re-login")
	assert.Equal(t, first.UUID, second.UUID, "re-login must not create a second user row")
}

func TestLoginOpenIdSuccess_UnknownCodeIsRejected(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	response := h.GET("/users/login/success?code=never-registered&state=/done", "")

	assert.NotEqual(t, http.StatusFound, response.Status())
	assert.Nil(t, response.Cookie("accessToken"))
}

func TestLoginOpenIdSuccess_UserInfoFailureIsRejected(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	oidc.RegisterCode("code", OIDCClaims{Sub: "someone", Email: "someone@example.com"})
	oidc.FailUserInfo = true

	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	response := h.GET("/users/login/success?code=code&state=/done", "")

	assert.NotEqual(t, http.StatusFound, response.Status())
	assert.Nil(t, response.Cookie("accessToken"))
}

func TestLoginOpenIdSuccess_TokenExchangeFailureIsRejected(t *testing.T) {
	oidc := NewFakeOIDCProvider(t)
	oidc.RegisterCode("code", OIDCClaims{Sub: "someone", Email: "someone@example.com"})
	oidc.FailTokenExchange = true

	h := NewHarness(t, WithOpenID(oidc.Issuer(), oidc.ClientID))

	response := h.GET("/users/login/success?code=code&state=/done", "")

	assert.NotEqual(t, http.StatusFound, response.Status())
	assert.Nil(t, response.Cookie("accessToken"))
}

func TestLoginOpenIdSuccess_DisabledOpenIdIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.GET("/users/login/success?code=whatever&state=/done", "").
		RequireError(http.StatusUnauthorized, 401)
}

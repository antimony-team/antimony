package test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// FakeOIDCProvider is a minimal OpenID Connect issuer: discovery, token exchange and userinfo.
//
// Antimony's auth manager only ever calls UserInfo on the provider (it never verifies an ID token),
// so the token endpoint hands out an opaque access token and no JWKS signing is involved.
type FakeOIDCProvider struct {
	Server *httptest.Server

	// ClientID is the client the harness should be configured with.
	ClientID string

	mu     sync.Mutex
	codes  map[string]OIDCClaims
	tokens map[string]OIDCClaims
	issued int

	// FailTokenExchange makes the token endpoint reject every exchange.
	FailTokenExchange bool

	// FailUserInfo makes the userinfo endpoint reject every request.
	FailUserInfo bool

	// OmitClaims makes userinfo answer with a body that has no usable claims.
	OmitClaims bool
}

// OIDCClaims is the claim set the fake issuer returns from its userinfo endpoint. The field names
// match what auth.Manager.AuthenticateWithCode reads.
type OIDCClaims struct {
	Sub    string   `json:"sub"`
	Email  string   `json:"email"`
	Groups []string `json:"groups"`
}

// NewFakeOIDCProvider starts the issuer and registers its shutdown with t.Cleanup.
func NewFakeOIDCProvider(t *testing.T) *FakeOIDCProvider {
	t.Helper()

	provider := &FakeOIDCProvider{
		ClientID: "antimony-test-client",
		codes:    make(map[string]OIDCClaims),
		tokens:   make(map[string]OIDCClaims),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", provider.handleDiscovery)
	mux.HandleFunc("/auth", provider.handleAuthorize)
	mux.HandleFunc("/token", provider.handleToken)
	mux.HandleFunc("/userinfo", provider.handleUserInfo)
	mux.HandleFunc("/keys", provider.handleKeys)

	provider.Server = httptest.NewServer(mux)
	t.Cleanup(provider.Server.Close)

	return provider
}

// Issuer is the issuer URL to configure the harness with.
func (p *FakeOIDCProvider) Issuer() string { return p.Server.URL }

// RegisterCode makes an authorization code exchangeable for the given claims.
func (p *FakeOIDCProvider) RegisterCode(code string, claims OIDCClaims) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.codes[code] = claims
}

func (p *FakeOIDCProvider) handleDiscovery(w http.ResponseWriter, _ *http.Request) {
	base := p.Server.URL

	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                base,
		"authorization_endpoint":                base + "/auth",
		"token_endpoint":                        base + "/token",
		"userinfo_endpoint":                     base + "/userinfo",
		"jwks_uri":                              base + "/keys",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"scopes_supported":                      []string{"openid", "email", "profile"},
	})
}

func (p *FakeOIDCProvider) handleAuthorize(w http.ResponseWriter, _ *http.Request) {
	// The harness never follows the redirect to the provider's login page; a body is enough.
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("fake authorization page"))
}

func (p *FakeOIDCProvider) handleToken(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.FailTokenExchange {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_grant"})
		return
	}

	if err := r.ParseForm(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_request"})
		return
	}

	claims, ok := p.codes[r.Form.Get("code")]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_grant"})
		return
	}

	p.issued++
	accessToken := fmt.Sprintf("fake-access-token-%d", p.issued)
	p.tokens[accessToken] = claims

	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   3600,
	})
}

func (p *FakeOIDCProvider) handleUserInfo(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.FailUserInfo {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid_token"})
		return
	}

	const bearerPrefix = "Bearer "

	header := r.Header.Get("Authorization")
	if len(header) <= len(bearerPrefix) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid_token"})
		return
	}

	claims, ok := p.tokens[header[len(bearerPrefix):]]
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid_token"})
		return
	}

	if p.OmitClaims {
		// A body that is valid JSON but carries no subject.
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}

	writeJSON(w, http.StatusOK, claims)
}

func (p *FakeOIDCProvider) handleKeys(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"keys": []any{}})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

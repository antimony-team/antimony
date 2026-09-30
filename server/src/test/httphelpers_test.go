package test

import (
	"antimonyBackend/utils"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Response wraps a recorded HTTP response with assertion helpers that understand Antimony's
// OkResponse / ErrorResponse envelopes.
type Response struct {
	*Harness

	Recorder *httptest.ResponseRecorder
	Method   string
	Path     string
}

/*
 * Request builders. An empty token means "send no accessToken cookie".
 */

func (h *Harness) GET(path string, token string) *Response {
	return h.do(http.MethodGet, path, nil, token)
}

func (h *Harness) POST(path string, body any, token string) *Response {
	return h.do(http.MethodPost, path, body, token)
}

func (h *Harness) PATCH(path string, body any, token string) *Response {
	return h.do(http.MethodPatch, path, body, token)
}

func (h *Harness) DELETE(path string, token string) *Response {
	return h.do(http.MethodDelete, path, nil, token)
}

// RawBody sends a request with a verbatim body, for malformed-payload tests.
func (h *Harness) RawBody(method string, path string, body string, token string) *Response {
	h.T.Helper()

	return h.request(method, path, strings.NewReader(body), token, true)
}

// WithCookies sends a request carrying arbitrary cookies, for the auth and refresh endpoints.
func (h *Harness) WithCookies(method string, path string, cookies ...*http.Cookie) *Response {
	h.T.Helper()

	request := httptest.NewRequest(method, path, nil)
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}

	recorder := httptest.NewRecorder()
	h.Engine.ServeHTTP(recorder, request)

	return &Response{Harness: h, Recorder: recorder, Method: method, Path: path}
}

func (h *Harness) do(method string, path string, body any, token string) *Response {
	h.T.Helper()

	var reader io.Reader
	hasBody := false

	if body != nil {
		encoded, err := json.Marshal(body)
		require.NoError(h.T, err)

		reader = bytes.NewReader(encoded)
		hasBody = true
	}

	return h.request(method, path, reader, token, hasBody)
}

func (h *Harness) request(
	method string,
	path string,
	body io.Reader,
	token string,
	hasBody bool,
) *Response {
	h.T.Helper()

	request := httptest.NewRequest(method, path, body)
	if hasBody {
		request.Header.Set("Content-Type", "application/json")
	}

	if token != "" {
		request.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	}

	recorder := httptest.NewRecorder()
	h.Engine.ServeHTTP(recorder, request)

	return &Response{Harness: h, Recorder: recorder, Method: method, Path: path}
}

/*
 * Assertions.
 */

// Status returns the response status code.
func (r *Response) Status() int { return r.Recorder.Code }

// Body returns the raw response body.
func (r *Response) Body() string { return r.Recorder.Body.String() }

// RequireStatus asserts the status code and returns the response for chaining.
func (r *Response) RequireStatus(status int) *Response {
	r.T.Helper()

	require.Equalf(
		r.T, status, r.Recorder.Code,
		"%s %s: unexpected status, body: %s", r.Method, r.Path, r.Body(),
	)

	return r
}

// RequireOk asserts a 200 and decodes the OkResponse payload into out. Pass nil for out when the
// endpoint answers 200 with an empty body, which several of the auth endpoints do.
func (r *Response) RequireOk(out any) {
	r.T.Helper()

	r.RequireStatus(http.StatusOK)

	if out == nil {
		return
	}

	var envelope utils.OkResponse[json.RawMessage]
	require.NoErrorf(
		r.T, json.Unmarshal(r.Recorder.Body.Bytes(), &envelope),
		"%s %s: response is not an OkResponse envelope, body: %s", r.Method, r.Path, r.Body(),
	)

	require.NoErrorf(
		r.T, json.Unmarshal(envelope.Payload, out),
		"%s %s: failed to decode payload %s", r.Method, r.Path, string(envelope.Payload),
	)
}

// RequireEmptyOk asserts a 200 with no response body.
func (r *Response) RequireEmptyOk() {
	r.T.Helper()

	r.RequireStatus(http.StatusOK)
	assert.Emptyf(r.T, r.Body(), "%s %s: expected an empty body", r.Method, r.Path)
}

// RequireError asserts the HTTP status and the Antimony error code in the body, and returns the
// decoded error for further assertions on its message.
func (r *Response) RequireError(status int, code int) utils.ErrorResponse {
	r.T.Helper()

	r.RequireStatus(status)

	var errorResponse utils.ErrorResponse
	require.NoErrorf(
		r.T, json.Unmarshal(r.Recorder.Body.Bytes(), &errorResponse),
		"%s %s: response is not an ErrorResponse envelope, body: %s", r.Method, r.Path, r.Body(),
	)

	assert.Equalf(
		r.T, code, errorResponse.Code,
		"%s %s: unexpected error code, body: %s", r.Method, r.Path, r.Body(),
	)

	return errorResponse
}

// RequireValidationError asserts a request-body validation failure.
//
// Note the status: the handlers answer these with utils.CreateValidationError, which is a 422, but
// gin's ctx.Bind has already flushed a 400 via AbortWithError by then. The status on the wire is
// therefore always 400 and only the body carries the 422 code.
func (r *Response) RequireValidationError() utils.ErrorResponse {
	r.T.Helper()

	return r.RequireError(http.StatusBadRequest, 422)
}

// Cookie returns a Set-Cookie entry by name, or nil if the response did not set it.
func (r *Response) Cookie(name string) *http.Cookie {
	r.T.Helper()

	for _, cookie := range r.Recorder.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}

	return nil
}

// RequireCookie asserts that a cookie was set with a non-empty value and returns it.
func (r *Response) RequireCookie(name string) *http.Cookie {
	r.T.Helper()

	cookie := r.Cookie(name)
	require.NotNilf(r.T, cookie, "%s %s: expected cookie %q to be set", r.Method, r.Path, name)
	assert.NotEmptyf(r.T, cookie.Value, "%s %s: expected cookie %q to have a value", r.Method, r.Path, name)

	return cookie
}

// RequireClearedCookie asserts that a cookie was expired (MaxAge < 0 and no value).
func (r *Response) RequireClearedCookie(name string) {
	r.T.Helper()

	cookie := r.Cookie(name)
	require.NotNilf(r.T, cookie, "%s %s: expected cookie %q to be cleared", r.Method, r.Path, name)
	assert.Emptyf(r.T, cookie.Value, "%s %s: expected cookie %q to be emptied", r.Method, r.Path, name)
	assert.Negativef(r.T, cookie.MaxAge, "%s %s: expected cookie %q to be expired", r.Method, r.Path, name)
}

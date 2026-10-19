package cors

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func createEngine(isDesktopEnabled bool) *gin.Engine {
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	engine.Use(Middleware(isDesktopEnabled))
	engine.GET("/labs", func(ctx *gin.Context) { ctx.String(http.StatusOK, "labs") })
	engine.GET("/socket.io/*any", func(ctx *gin.Context) { ctx.String(http.StatusOK, "socket") })

	return engine
}

func serve(engine *gin.Engine, method string, path string, origin string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	if origin != "" {
		request.Header.Set("Origin", origin)
	}

	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	return recorder
}

func assertNoCorsHeaders(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()

	for _, header := range []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers",
		"Access-Control-Max-Age",
	} {
		assert.Emptyf(t, recorder.Header().Get(header), "expected no %s header", header)
	}
}

func TestMiddleware_DesktopOriginGetsCorsHeaders(t *testing.T) {
	recorder := serve(createEngine(true), http.MethodGet, "/labs", "null")

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "labs", recorder.Body.String(), "the request must still reach the handler")
	assert.Equal(t, "null", recorder.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, recorder.Header().Values("Vary"), "Origin")
	assert.Empty(t, recorder.Header().Get("Access-Control-Allow-Credentials"), "credentials are never allowed")
}

func TestMiddleware_DesktopPreflightIsAnswered(t *testing.T) {
	for _, path := range []string{"/labs", "/route-that-does-not-exist"} {
		t.Run(path, func(t *testing.T) {
			recorder := serve(createEngine(true), http.MethodOptions, path, "null")

			assert.Equal(t, http.StatusNoContent, recorder.Code)
			assert.Empty(t, recorder.Body.String())
			assert.Equal(t, "null", recorder.Header().Get("Access-Control-Allow-Origin"))
			assert.Equal(t, "GET, POST, PUT, PATCH, DELETE", recorder.Header().Get("Access-Control-Allow-Methods"))
			assert.Equal(t, "Authorization, Content-Type", recorder.Header().Get("Access-Control-Allow-Headers"))
			assert.NotEmpty(t, recorder.Header().Get("Access-Control-Max-Age"))
		})
	}
}

func TestMiddleware_DesktopDisabledSetsNoHeaders(t *testing.T) {
	engine := createEngine(false)

	assertNoCorsHeaders(t, serve(engine, http.MethodGet, "/labs", "null"))

	preflight := serve(engine, http.MethodOptions, "/labs", "null")
	assert.NotEqual(t, http.StatusNoContent, preflight.Code, "preflights must not be answered")
	assertNoCorsHeaders(t, preflight)
}

func TestMiddleware_OtherOriginsGetNoHeaders(t *testing.T) {
	engine := createEngine(true)

	for _, origin := range []string{"", "http://localhost:8080", "https://evil.example", "Null", "null "} {
		t.Run(origin, func(t *testing.T) {
			recorder := serve(engine, http.MethodGet, "/labs", origin)

			assert.Equal(t, http.StatusOK, recorder.Code)
			assertNoCorsHeaders(t, recorder)

			preflight := serve(engine, http.MethodOptions, "/labs", origin)
			assert.NotEqual(t, http.StatusNoContent, preflight.Code)
			assertNoCorsHeaders(t, preflight)
		})
	}
}

func TestMiddleware_SocketIOIsLeftAlone(t *testing.T) {
	engine := createEngine(true)

	recorder := serve(engine, http.MethodGet, "/socket.io/?EIO=4&transport=polling", "null")
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "socket", recorder.Body.String())
	assertNoCorsHeaders(t, recorder)

	preflight := serve(engine, http.MethodOptions, "/socket.io/?EIO=4&transport=polling", "null")
	assert.NotEqual(t, http.StatusNoContent, preflight.Code)
	assertNoCorsHeaders(t, preflight)
}

package cors

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// desktopOrigin is the origin of the desktop app's requests. Its window is loaded from a file, and browsers send
// the origin "null" for pages that aren't served from a website.
const desktopOrigin = "null"

// Middleware allows the desktop app's cross-origin requests to the REST API when desktop authentication is
// enabled. Web interfaces are served from the server's own origin and don't need CORS. The desktop app
// authenticates with the Authorization header, not with cookies, so credentials aren't allowed.
//
// Socket.IO answers cross-origin requests itself, see socket.CreateManager.
func Middleware(isDesktopEnabled bool) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if !isDesktopEnabled ||
			ctx.GetHeader("Origin") != desktopOrigin ||
			strings.HasPrefix(ctx.Request.URL.Path, "/socket.io/") {
			ctx.Next()
			return
		}

		header := ctx.Writer.Header()
		header.Set("Access-Control-Allow-Origin", desktopOrigin)
		header.Add("Vary", "Origin")

		// Preflight requests for JSON bodies and the Authorization header
		if ctx.Request.Method == http.MethodOptions {
			header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
			header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			header.Set("Access-Control-Max-Age", "600")
			ctx.AbortWithStatus(http.StatusNoContent)
			return
		}

		ctx.Next()
	}
}

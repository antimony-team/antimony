package device

import (
	"antimonyBackend/auth"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler, authManager auth.AuthManager) {
	routes := route.Group("/devices", authManager.AuthenticatorMiddleware())
	{
		routes.GET("", handler.Get)
	}
}

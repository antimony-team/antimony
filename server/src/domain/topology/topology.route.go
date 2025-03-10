package topology

import (
	"antimonyBackend/src/auth"
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler, authManager auth.AuthManager) {
	routes := route.Group("/topologies", authManager.AuthenticatorMiddleware())
	{
		routes.GET("", handler.Get)
		routes.POST("", handler.Create)
		routes.PATCH("/:id", handler.Update)
		routes.DELETE("/:id", handler.Delete)
	}
}

package lab

import (
	"antimonyBackend/auth"
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler, authManager auth.AuthManager) {
	routes := route.Group("/labs", authManager.AuthenticatorMiddleware())
	{
		routes.GET("", handler.Get)
		routes.POST("", handler.Create)
		routes.PATCH("/:labId", handler.Update)
		routes.DELETE("/:labId", handler.Delete)
	}
}

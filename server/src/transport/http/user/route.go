package user

import (
	"antimonyBackend/auth"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler *Handler) {
	routes := route.Group("/users")
	{
		routes.POST("/logout", handler.Logout)
		routes.POST("/login/native", handler.LoginNative)
		routes.GET("/login/openid", handler.LoginOpenId)
		routes.GET("/login/auth-config", handler.AuthConfig)
		routes.GET("/login/success", handler.LoginOpenIdSuccess)
		routes.GET("/login/refresh", handler.RefreshToken)
	}
}

// RegisterDevRoutes registers endpoints that are only available in development mode (-dev).
func RegisterDevRoutes(route *gin.Engine, handler *Handler, authManager *auth.Manager) {
	route.POST("/users", authManager.AuthenticatorMiddleware(), handler.CreateNativeUser)
}

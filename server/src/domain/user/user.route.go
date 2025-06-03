package user

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler) {
	routes := route.Group("/users")
	{
		routes.POST("/logout", handler.Logout)
		routes.POST("/login/native", handler.LoginNative)
		routes.GET("/login/openid", handler.LoginOpenId)
		routes.GET("/login/config", handler.AuthConfig)
		routes.GET("/login/success", handler.LoginOpenIdSuccess)
		routes.GET("/login/refresh", handler.RefreshToken)
	}
}

package user

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler) {
	routes := route.Group("/users")
	{
		routes.POST("/login", handler.Login)
		routes.GET("/logout", handler.Logout)
		routes.GET("/login/openid", handler.LoginOIDC)
		routes.GET("/login/success", handler.LoginSuccess)
		routes.GET("/login/refresh", handler.RefreshToken)
	}
}

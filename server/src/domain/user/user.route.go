package user

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler) {
	routes := route.Group("/login")
	{
		routes.POST("", handler.Login)
	}
}

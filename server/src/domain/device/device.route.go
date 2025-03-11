package device

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler) {
	routes := route.Group("/devices")
	{
		routes.GET("", handler.Get)
	}
}

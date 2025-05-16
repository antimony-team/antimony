package schema

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler) {
	routes := route.Group("/clab-schema")
	{
		routes.GET("", handler.Get)
	}
}

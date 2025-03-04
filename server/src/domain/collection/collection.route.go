package collection

import (
	"github.com/gin-gonic/gin"
)

func RegisterResources(route *gin.Engine, handler Handler) {
	routes := route.Group("/collections")
	{
		routes.GET("", handler.Get)
		routes.POST("", handler.Create)
		routes.PATCH("/:id", handler.Update)
		routes.DELETE("/:id", handler.Delete)
	}
}

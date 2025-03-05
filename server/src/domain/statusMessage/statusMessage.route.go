package statusMessage

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler) {
	routes := route.Group("/status-messages")
	{
		routes.GET("", handler.Get)
	}
}

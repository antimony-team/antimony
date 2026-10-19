package collection

import (
	"github.com/gin-gonic/gin"

	"github.com/antimony-team/antimony-server/auth"
)

func RegisterRoutes(route *gin.Engine, handler *Handler, authManager *auth.Manager) {
	routes := route.Group("/collections", authManager.AuthenticatorMiddleware())
	{
		routes.GET("", handler.Get)
		routes.POST("", handler.Create)
		routes.PATCH("/:collectionId", handler.Update)
		routes.DELETE("/:collectionId", handler.Delete)
	}
}

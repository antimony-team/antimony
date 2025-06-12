package topology

import (
	"antimonyBackend/auth"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(route *gin.Engine, handler Handler, authManager auth.AuthManager) {
	routes := route.Group("/topologies", authManager.AuthenticatorMiddleware())
	{
		routes.GET("", handler.Get)
		routes.POST("", handler.Create)
		routes.PATCH("/:topologyId", handler.Update)
		routes.DELETE("/:topologyId", handler.Delete)

		routes.POST("/:topologyId/files", handler.CreateBindFile)
		routes.PATCH("/:topologyId/files/:fileId", handler.UpdateBindFile)
		routes.DELETE("/:topologyId/files/:fileId", handler.DeleteBindFile)
	}
}

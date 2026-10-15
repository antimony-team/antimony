package device

import (
	"github.com/gin-gonic/gin"

	"github.com/antimony-team/antimony-server/auth"
)

func RegisterRoutes(route *gin.Engine, handler *Handler, authManager *auth.Manager) {
	routes := route.Group("/devices", authManager.AuthenticatorMiddleware())
	{
		routes.GET("", handler.Get)
	}
}

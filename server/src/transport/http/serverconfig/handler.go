package serverconfig

import (
	"antimonyBackend/domain/serverconfig"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
)

type (
	Handler struct {
		service *serverconfig.Service
	}
)

func CreateHandler(service *serverconfig.Service) *Handler {
	return &Handler{
		service: service,
	}
}

// @Summary	Get the server configuration
// @Produce	json
// @Tags		config
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]serverconfig.ServerConfig]
// @Failure	401	{object}	nil							"The user isn't authorized"
// @Failure	498	{object}	nil							"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse[string]	"The user doesn't have access to the resource"
// @Router		/config [get]
func (h *Handler) Get(ctx *gin.Context) {
	ctx.JSON(utils.CreateOkResponse(h.service.GetServerConfig()))
}

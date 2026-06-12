package serverconfig

import (
	"antimonyBackend/domain/serverconfig"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
	}

	handler struct {
		configService serverconfig.Service
	}
)

func CreateHandler(configService serverconfig.Service) Handler {
	return &handler{
		configService: configService,
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
func (h *handler) Get(ctx *gin.Context) {
	ctx.JSON(utils.CreateOkResponse(h.configService.GetServerConfig()))
}

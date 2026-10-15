package device

import (
	"antimonyBackend/domain/device"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *device.Service
}

func CreateHandler(service *device.Service) *Handler {
	return &Handler{
		service: service,
	}
}

// @Summary	Get all device configurations
// @Produce	json
// @Tags		devices
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]device.DeviceConfig]
// @Failure	401	{object}	nil							"The user isn't authorized"
// @Failure	498	{object}	nil							"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse[string]	"The user doesn't have access to the resource"
// @Router		/devices [get]
func (h *Handler) Get(ctx *gin.Context) {
	ctx.JSON(utils.CreateOkResponse(h.service.Get()))
}

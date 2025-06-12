package device

import (
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
	}

	deviceHandler struct {
		deviceService Service
	}
)

func CreateHandler(deviceService Service) Handler {
	return &deviceHandler{
		deviceService: deviceService,
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
func (h *deviceHandler) Get(ctx *gin.Context) {
	ctx.JSON(utils.CreateOkResponse(h.deviceService.Get()))
}

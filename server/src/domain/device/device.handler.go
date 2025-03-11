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

func (h *deviceHandler) Get(ctx *gin.Context) {
	ctx.JSON(utils.OkResponse(h.deviceService.Get()))
}

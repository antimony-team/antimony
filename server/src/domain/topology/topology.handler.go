package topology

import (
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
		Create(ctx *gin.Context)
		Update(ctx *gin.Context)
		Delete(ctx *gin.Context)
	}

	topologyHandler struct {
		topologyService Service
	}
)

func CreateHandler(topologyService Service) Handler {
	return &topologyHandler{
		topologyService: topologyService,
	}
}

func (h *topologyHandler) Get(ctx *gin.Context) {
	result, err := h.topologyService.Get(ctx)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *topologyHandler) Create(ctx *gin.Context) {
	payload := TopologyIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	result, err := h.topologyService.Create(ctx, payload)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *topologyHandler) Update(ctx *gin.Context) {
	payload := TopologyIn{}
	err := ctx.Bind(&payload)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	err = h.topologyService.Update(ctx, payload, ctx.Param("id"))
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *topologyHandler) Delete(ctx *gin.Context) {
	err := h.topologyService.Delete(ctx, ctx.Param("id"))
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

package topology

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
		Create(ctx *gin.Context)
		Update(ctx *gin.Context)
		Delete(ctx *gin.Context)

		CreateBindFile(ctx *gin.Context)
		UpdateBindFile(ctx *gin.Context)
		DeleteBindFile(ctx *gin.Context)
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
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.topologyService.Get(ctx, authUser)
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

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.topologyService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *topologyHandler) Update(ctx *gin.Context) {
	payload := TopologyIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.Update(ctx, payload, ctx.Param("topologyId"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *topologyHandler) Delete(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.Delete(ctx, ctx.Param("topologyId"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *topologyHandler) CreateBindFile(ctx *gin.Context) {
	payload := BindFileIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.topologyService.CreateBindFile(ctx, ctx.Param("topologyId"), payload, authUser)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *topologyHandler) UpdateBindFile(ctx *gin.Context) {
	payload := BindFileIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.UpdateBindFile(ctx, payload, ctx.Param("bindFileId"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *topologyHandler) DeleteBindFile(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.DeleteBindFile(ctx, ctx.Param("bindFileId"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

package lab

import (
	"antimonyBackend/src/auth"
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

	labHandler struct {
		labService Service
	}
)

func CreateHandler(labService Service) Handler {
	return &labHandler{
		labService: labService,
	}
}

func (h *labHandler) Get(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.labService.Get(ctx, authUser)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *labHandler) Create(ctx *gin.Context) {
	payload := LabIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.labService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *labHandler) Update(ctx *gin.Context) {
	payload := LabIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.labService.Update(ctx, payload, ctx.Param("id"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *labHandler) Delete(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.labService.Delete(ctx, ctx.Param("id"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

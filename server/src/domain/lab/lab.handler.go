package lab

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

	collectionHandler struct {
		collectionService Service
	}
)

func CreateHandler(collectionService Service) Handler {
	return &collectionHandler{
		collectionService: collectionService,
	}
}

func (h *collectionHandler) Get(ctx *gin.Context) {
	result, err := h.collectionService.Get(ctx)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *collectionHandler) Create(ctx *gin.Context) {
	payload := CollectionIn{}
	err := ctx.Bind(&payload)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	result, err := h.collectionService.Create(ctx, payload)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *collectionHandler) Update(ctx *gin.Context) {
	payload := CollectionIn{}
	err := ctx.Bind(&payload)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	err = h.collectionService.Update(ctx, payload, ctx.Param("id"))
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *collectionHandler) Delete(ctx *gin.Context) {
	err := h.collectionService.Delete(ctx, ctx.Param("id"))
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

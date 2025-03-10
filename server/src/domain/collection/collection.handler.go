package collection

import (
	"antimonyBackend/src/auth"
	"antimonyBackend/src/utils"
	"github.com/charmbracelet/log"
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
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.collectionService.Get(ctx, authUser)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *collectionHandler) Create(ctx *gin.Context) {
	payload := CollectionIn{}
	if err := ctx.Bind(&payload); err != nil {
		log.Errorf("COLLECTION CREATE: %v", payload.PublicWrite)
		log.Errorf("COLLECTION DEPLOY: %v", payload.PublicDeploy)
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.collectionService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

func (h *collectionHandler) Update(ctx *gin.Context) {
	payload := CollectionIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.collectionService.Update(ctx, payload, ctx.Param("id"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

func (h *collectionHandler) Delete(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.collectionService.Delete(ctx, ctx.Param("id"), authUser); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(nil))
}

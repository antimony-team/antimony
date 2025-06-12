package collection

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

// @Summary	Retrieve all collections the user has access to
// @Produce	json
// @Tags		collections
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]collection.CollectionOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Router		/collections [get]
func (h *collectionHandler) Get(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	result, err := h.collectionService.Get(ctx, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Create a new collection
// @Accept		json
// @Produce	json
// @Tags		collections
// @Security	BasicAuth
// @Success	200		{object}	utils.OkResponse[string]	"The ID of the newly created collection"
// @Failure	401		{object}	nil							"The user isn't authorized"
// @Failure	498		{object}	nil							"The provided access token is not valid"
// @Failure	403		{object}	utils.ErrorResponse			"Access to the resource was denied. Details in the request body."
// @Param		request	body		collection.CollectionIn		true	"The collection"
// @Router		/collections [post]
func (h *collectionHandler) Create(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := CollectionIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	result, err := h.collectionService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Update an existing collection
// @Accept		json
// @Produce	json
// @Tags		collections
// @Security	BasicAuth
// @Success	200		{object}	nil
// @Failure	401		{object}	nil								"The user isn't authorized"
// @Failure	498		{object}	nil								"The provided access token is not valid"
// @Failure	403		{object}	utils.ErrorResponse				"Access to the resource was denied. Details in the request body."
// @Failure	422		{object}	utils.ErrorResponse				"The request was invalid. Details in the response body."
// @Param		request	body		collection.CollectionInPartial	true	"A partial collection with updated values"
// @Param		id		path		string							true	"The ID of the collection to edit"
// @Router		/collections/{id} [patch]
func (h *collectionHandler) Update(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := CollectionInPartial{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	if err := h.collectionService.Update(ctx, payload, ctx.Param("collectionId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

// @Summary	Delete an existing collection
// @Produce	json
// @Tags		collections
// @Security	BasicAuth
// @Success	200	{object}	nil
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422	{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		id	path		string				true	"The ID of the collection to edit"
// @Router		/collections/{id} [delete]
func (h *collectionHandler) Delete(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	if err := h.collectionService.Delete(ctx, ctx.Param("collectionId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

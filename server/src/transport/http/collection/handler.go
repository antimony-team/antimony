package collection

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/transport"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type Handler struct {
	service *collection.Service
}

func CreateHandler(service *collection.Service) *Handler {
	return &Handler{
		service: service,
	}
}

// @Summary	Retrieve all collections the user has access to
// @Produce	json
// @Tags		collections
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]transport.CollectionOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Router		/collections [get]
func (h *Handler) Get(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	collections, err := h.service.Get(ctx, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	collectionsOut := lo.Map(collections, func(collection collection.Collection, _ int) *transport.CollectionOut {
		return transport.CollectionToOut(&collection)
	})

	ctx.JSON(utils.CreateOkResponse(collectionsOut))
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
func (h *Handler) Create(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := collection.CollectionIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	result, err := h.service.Create(ctx, payload, authUser)
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
func (h *Handler) Update(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := collection.CollectionInPartial{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	if err := h.service.Update(ctx, payload, ctx.Param("collectionId"), authUser); err != nil {
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
func (h *Handler) Delete(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	if err := h.service.Delete(ctx, ctx.Param("collectionId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

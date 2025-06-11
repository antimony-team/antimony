package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
		GetByUuid(ctx *gin.Context)
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

// @Summary	Get all labs
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]lab.LabOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Router		/labs [get]
func (h *labHandler) Get(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	var labFilter LabFilter
	if err := ctx.BindQuery(&labFilter); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	result, err := h.labService.Get(ctx, labFilter, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Get a specific lab by UUIDp
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[LabOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	404	{object}	utils.ErrorResponse	"The requested lab was not found."
// @Router		/labs/:labId [get]
func (h *labHandler) GetByUuid(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)

	result, err := h.labService.GetByUuid(ctx, ctx.Param("labId"), authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Create a new lab
// @Accept		json
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200		{object}	utils.OkResponse[string]	"The ID of the newly created lab"
// @Failure	401		{object}	nil							"The user isn't authorized"
// @Failure	498		{object}	nil							"The provided access token is not valid"
// @Failure	403		{object}	utils.ErrorResponse			"Access to the resource was denied. Details in the request body."
// @Param		request	body		lab.LabIn					true	"The lab"
// @Router		/labs [post]
func (h *labHandler) Create(ctx *gin.Context) {
	payload := LabIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.labService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Update an existing lab
// @Accept		json
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200		{object}	nil
// @Failure	401		{object}	nil					"The user isn't authorized"
// @Failure	498		{object}	nil					"The provided access token is not valid"
// @Failure	403		{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422		{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		request	body		lab.LabIn			true	"The lab with updated values"
// @Param		id		path		string				true	"The ID of the lab to edit"
// @Router		/labs/{id} [put]
func (h *labHandler) Update(ctx *gin.Context) {
	payload := LabInPartial{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.labService.Update(ctx, payload, ctx.Param("labId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

// @Summary	Delete an existing lab
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200	{object}	nil
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422	{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		id	path		string				true	"The ID of the lab to delete"
// @Router		/labs/{id} [delete]
func (h *labHandler) Delete(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.labService.Delete(ctx, ctx.Param("labId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/lab"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/transport"
	"antimonyBackend/utils"
	"slices"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type Handler struct {
	service         *lab.Service
	instanceService *instance.Service
}

func CreateHandler(service *lab.Service, instanceService *instance.Service) *Handler {
	return &Handler{
		service:         service,
		instanceService: instanceService,
	}
}

// @Summary	Get all labs
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]transport.LabOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Router		/labs [get]
func (h *Handler) Get(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	var labFilter lab.LabFilter
	if err := ctx.BindQuery(&labFilter); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	resultLabs, err := h.service.Get(ctx, labFilter, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	labsOut := lo.FilterMap(resultLabs, func(lab lab.Lab, _ int) (*transport.LabOut, bool) {
		if len(labFilter.StateFilter) > 0 {
			instanceState := instance.InstanceStates.Inactive

			labInstance := h.instanceService.GetInstance(lab.UUID)
			if labInstance != nil {
				instanceState = labInstance.State
			}

			// TODO(kian): Somehow fix this dependency issue
			/* else if s.labDeploymentSchedule.IsScheduled(lab.UUID) {
				instanceState = instance.InstanceStates.Scheduled
			}*/

			if !slices.Contains(labFilter.StateFilter, int(instanceState)) {
				return nil, false
			}
		}

		return transport.LabToOut(&lab, h.instanceService.GetInstance(lab.UUID)), true
	})

	ctx.JSON(utils.CreateOkResponse(labsOut))
}

// @Summary	Get a specific lab by UUIDp
// @Produce	json
// @Tags		labs
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[transport.LabOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	404	{object}	utils.ErrorResponse	"The requested lab was not found."
// @Router		/labs/:labId [get]
func (h *Handler) GetByUuid(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	resultLab, err := h.service.GetByUuid(ctx, ctx.Param("labId"), authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(transport.LabToOut(
		resultLab,
		h.instanceService.GetInstance(resultLab.UUID),
	)))
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
func (h *Handler) Create(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := lab.LabIn{}
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
func (h *Handler) Update(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := lab.LabInPartial{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	if err := h.service.Update(ctx, payload, ctx.Param("labId"), authUser); err != nil {
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
func (h *Handler) Delete(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	if err := h.service.Delete(ctx, ctx.Param("labId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

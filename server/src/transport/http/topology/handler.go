package topology

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/topology"
	"antimonyBackend/transport"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
		GetByUuid(ctx *gin.Context)
		Create(ctx *gin.Context)
		Update(ctx *gin.Context)
		Delete(ctx *gin.Context)

		CreateBindFile(ctx *gin.Context)
		UpdateBindFile(ctx *gin.Context)
		DeleteBindFile(ctx *gin.Context)
	}

	handler struct {
		topologyService topology.Service
	}
)

func CreateHandler(topologyService topology.Service) Handler {
	return &handler{
		topologyService: topologyService,
	}
}

// @Summary	Get all topologies
// @Produce	json
// @Tags		topologies
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[[]transport.TopologyOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Router		/topologies [get]
func (h *handler) Get(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	topologiesFull, err := h.topologyService.Get(ctx, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	topologiesOut := lo.Map(topologiesFull, func(topology topology.TopologyFull, _ int) transport.TopologyOut {
		return *transport.TopologyToOut(&topology)
	})

	ctx.JSON(utils.CreateOkResponse(topologiesOut))
}

// @Summary	Get a specific topology by UUID
// @Produce	json
// @Tags		topologies
// @Security	BasicAuth
// @Success	200	{object}	utils.OkResponse[transport.TopologyOut]
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	404	{object}	utils.ErrorResponse	"The requested topology was not found."
// @Router		/topologies/:topologyId [get]
func (h *handler) GetByUuid(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	topologyFull, err := h.topologyService.GetByUuid(ctx, ctx.Param("topologyId"), authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(*transport.TopologyToOut(topologyFull)))
}

// @Summary	Create a new topology
// @Accept		json
// @Produce	json
// @Tags		topologies
// @Security	BasicAuth
// @Success	200		{object}	utils.OkResponse[string]	"The ID of the newly created collection"
// @Failure	401		{object}	nil							"The user isn't authorized"
// @Failure	498		{object}	nil							"The provided access token is not valid"
// @Failure	403		{object}	utils.ErrorResponse			"Access to the resource was denied. Details in the request body."
// @Param		request	body		topology.TopologyIn			true	"The topology"
// @Router		/topologies [post]
func (h *handler) Create(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := topology.TopologyIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	result, err := h.topologyService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Update an existing topology
// @Accept		json
// @Produce	json
// @Tags		topologies
// @Security	BasicAuth
// @Success	200		{object}	nil
// @Failure	401		{object}	nil					"The user isn't authorized"
// @Failure	498		{object}	nil					"The provided access token is not valid"
// @Failure	403		{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422		{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		request	body		topology.TopologyIn	true	"The topology with updated values"
// @Param		id		path		string				true	"The ID of the topology to edit"
// @Router		/topologies/{id} [patch]
func (h *handler) Update(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := topology.TopologyInPartial{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	if err := h.topologyService.Update(ctx, payload, ctx.Param("topologyId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

// @Summary	Delete an existing topology
// @Produce	json
// @Tags		topologies
// @Security	BasicAuth
// @Success	200	{object}	nil
// @Failure	401	{object}	nil					"The user isn't authorized"
// @Failure	498	{object}	nil					"The provided access token is not valid"
// @Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422	{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		id	path		string				true	"The ID of the topology to delete"
// @Router		/topologies/{id} [delete]
func (h *handler) Delete(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	if err := h.topologyService.Delete(ctx, ctx.Param("topologyId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

// @Summary	Create a new bind file for a topology
// @Accept		json
// @Produce	json
// @Tags		bindFiles
// @Security	BasicAuth
// @Success	200			{object}	utils.OkResponse[string]	"The ID of the newly created file"
// @Failure	401			{object}	nil							"The user isn't authorized"
// @Failure	498			{object}	nil							"The provided access token is not valid"
// @Failure	403			{object}	utils.ErrorResponse			"Access to the resource was denied. Details in the request body."
// @Param		request		body		topology.BindFileIn			true	"The bind file"
// @Param		topologyId	path		string						true	"The ID of the topology the bind file should belong to"
// @Router		/topologies/{topologyId}/files [post]
func (h *handler) CreateBindFile(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := topology.BindFileIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	result, err := h.topologyService.CreateBindFile(ctx, ctx.Param("topologyId"), payload, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

// @Summary	Update an existing bind file of a topology
// @Produce	json
// @Tags		bindFiles
// @Security	BasicAuth
// @Success	200			{object}	nil
// @Failure	401			{object}	nil					"The user isn't authorized"
// @Failure	498			{object}	nil					"The provided access token is not valid"
// @Failure	403			{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422			{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		topologyId	path		string				true	"The ID of the topology the bind file belongs to"
// @Param		bindFileId	path		string				true	"The ID of the bind file to edit"
// @Router		/topologies/{topologyId}/files/{bindFileId} [patch]
func (h *handler) UpdateBindFile(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	payload := topology.BindFileInPartial{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateValidationError(err))
		return
	}

	if err := h.topologyService.UpdateBindFile(ctx, payload, ctx.Param("fileId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

// @Summary	Delete an existing bind file of a topology
// @Produce	json
// @Tags		bindFiles
// @Security	BasicAuth
// @Success	200			{object}	nil
// @Failure	401			{object}	nil					"The user isn't authorized"
// @Failure	498			{object}	nil					"The provided access token is not valid"
// @Failure	403			{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
// @Failure	422			{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
// @Param		topologyId	path		string				true	"The ID of the topology the bind file belongs to"
// @Param		bindFileId	path		string				true	"The ID of the bind file to delete"
// @Router		/topologies/{topologyId}/files/{bindFileId} [delete]
func (h *handler) DeleteBindFile(ctx *gin.Context) {
	authUser, ok := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if !ok {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrTokenInvalid))
	}

	if err := h.topologyService.DeleteBindFile(ctx, ctx.Param("fileId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

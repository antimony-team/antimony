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

//	@Summary	Get all topologies
//	@Produce	json
//	@Tags		topologies
//	@Security	BasicAuth
//	@Success	200	{object}	utils.OkResponse[[]topology.TopologyOut]
//	@Failure	401	{object}	nil					"The user isn't authorized"
//	@Failure	498	{object}	nil					"The provided access token is not valid"
//	@Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
//	@Router		/topologies [get]
func (h *topologyHandler) Get(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.topologyService.Get(ctx, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

//	@Summary	Create a new topology
//	@Accept		json
//	@Produce	json
//	@Tags		topologies
//	@Security	BasicAuth
//	@Success	200		{object}	utils.OkResponse[string]	"The ID of the newly created collection"
//	@Failure	401		{object}	nil							"The user isn't authorized"
//	@Failure	498		{object}	nil							"The provided access token is not valid"
//	@Failure	403		{object}	utils.ErrorResponse			"Access to the resource was denied. Details in the request body."
//	@Param		request	body		topology.TopologyIn			true	"The topology"
//	@Router		/topologies [post]
func (h *topologyHandler) Create(ctx *gin.Context) {
	payload := TopologyIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.topologyService.Create(ctx, payload, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

//	@Summary	Update an existing topology
//	@Accept		json
//	@Produce	json
//	@Tags		topologies
//	@Security	BasicAuth
//	@Success	200		{object}	nil
//	@Failure	401		{object}	nil					"The user isn't authorized"
//	@Failure	498		{object}	nil					"The provided access token is not valid"
//	@Failure	403		{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
//	@Failure	422		{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
//	@Param		request	body		topology.TopologyIn	true	"The topology with updated values"
//	@Param		id		path		string				true	"The ID of the topology to edit"
//	@Router		/topologies/{id} [put]
func (h *topologyHandler) Update(ctx *gin.Context) {
	payload := TopologyIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.Update(ctx, payload, ctx.Param("topologyId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

//	@Summary	Delete an existing topology
//	@Produce	json
//	@Tags		topologies
//	@Security	BasicAuth
//	@Success	200	{object}	nil
//	@Failure	401	{object}	nil					"The user isn't authorized"
//	@Failure	498	{object}	nil					"The provided access token is not valid"
//	@Failure	403	{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
//	@Failure	422	{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
//	@Param		id	path		string				true	"The ID of the topology to delete"
//	@Router		/topologies/{id} [delete]
func (h *topologyHandler) Delete(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.Delete(ctx, ctx.Param("topologyId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

//	@Summary	Create a new bind file for a topology
//	@Accept		json
//	@Produce	json
//	@Tags		bindFiles
//	@Security	BasicAuth
//	@Success	200			{object}	utils.OkResponse[string]	"The ID of the newly created file"
//	@Failure	401			{object}	nil							"The user isn't authorized"
//	@Failure	498			{object}	nil							"The provided access token is not valid"
//	@Failure	403			{object}	utils.ErrorResponse			"Access to the resource was denied. Details in the request body."
//	@Param		request		body		topology.BindFileIn			true	"The bind file"
//	@Param		topologyId	path		string						true	"The ID of the topology the bind file should belong to"
//	@Router		/topologies/{topologyId}/files [post]
func (h *topologyHandler) CreateBindFile(ctx *gin.Context) {
	payload := BindFileIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	result, err := h.topologyService.CreateBindFile(ctx, ctx.Param("topologyId"), payload, authUser)
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(result))
}

//	@Summary	Update an existing bind file of a topology
//	@Produce	json
//	@Tags		bindFiles
//	@Security	BasicAuth
//	@Success	200			{object}	nil
//	@Failure	401			{object}	nil					"The user isn't authorized"
//	@Failure	498			{object}	nil					"The provided access token is not valid"
//	@Failure	403			{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
//	@Failure	422			{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
//	@Param		topologyId	path		string				true	"The ID of the topology the bind file belongs to"
//	@Param		bindFileId	path		string				true	"The ID of the bind file to edit"
//	@Router		/topologies/{topologyId}/files/{bindFileId} [put]
func (h *topologyHandler) UpdateBindFile(ctx *gin.Context) {
	payload := BindFileIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.UpdateBindFile(ctx, payload, ctx.Param("fileId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

//	@Summary	Delete an existing bind file of a topology
//	@Produce	json
//	@Tags		bindFiles
//	@Security	BasicAuth
//	@Success	200			{object}	nil
//	@Failure	401			{object}	nil					"The user isn't authorized"
//	@Failure	498			{object}	nil					"The provided access token is not valid"
//	@Failure	403			{object}	utils.ErrorResponse	"Access to the resource was denied. Details in the request body."
//	@Failure	422			{object}	utils.ErrorResponse	"The request was invalid. Details in the response body."
//	@Param		topologyId	path		string				true	"The ID of the topology the bind file belongs to"
//	@Param		bindFileId	path		string				true	"The ID of the bind file to delete"
//	@Router		/topologies/{topologyId}/files/{bindFileId} [delete]
func (h *topologyHandler) DeleteBindFile(ctx *gin.Context) {
	authUser := ctx.MustGet("authUser").(auth.AuthenticatedUser)
	if err := h.topologyService.DeleteBindFile(ctx, ctx.Param("fileId"), authUser); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse[any](nil))
}

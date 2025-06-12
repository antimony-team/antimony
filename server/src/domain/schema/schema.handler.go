package schema

import (
	"antimonyBackend/utils"
	"encoding/json"

	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
	}

	schemaHandler struct {
		schemaService Service
	}
)

func CreateHandler(schemaService Service) Handler {
	return &schemaHandler{
		schemaService: schemaService,
	}
}

// @Summary	Returns the JSON schema to validate topology definitions
// @Produce	json
// @Tags		schema
// @Success	200	{object}	utils.OkResponse[any]	"The schema as JSON object"
// @Router		/schema [get]
func (h *schemaHandler) Get(ctx *gin.Context) {
	var schemaObj any
	if err := json.Unmarshal([]byte(h.schemaService.Get()), &schemaObj); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(schemaObj))
}

package schema

import (
	"antimonyBackend/domain/schema"
	"antimonyBackend/utils"
	"encoding/json"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *schema.Service
}

func CreateHandler(service *schema.Service) *Handler {
	return &Handler{
		service: service,
	}
}

// @Summary	Returns the JSON schema to validate topology definitions
// @Produce	json
// @Tags		schema
// @Success	200	{object}	utils.OkResponse[any]	"The schema as JSON object"
// @Router		/schema [get]
func (h *Handler) Get(ctx *gin.Context) {
	var schemaObj any
	if err := json.Unmarshal([]byte(h.service.Get()), &schemaObj); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.JSON(utils.CreateOkResponse(schemaObj))
}

package schema

import (
	"antimonyBackend/utils"
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

func (h *schemaHandler) Get(ctx *gin.Context) {
	ctx.JSON(utils.OkResponse(h.schemaService.Get()))
}

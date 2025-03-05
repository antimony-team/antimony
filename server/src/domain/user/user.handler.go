package user

import (
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Login(ctx *gin.Context)
	}

	userHandler struct {
		userService Service
	}
)

func CreateHandler(userService Service) Handler {
	return &userHandler{
		userService: userService,
	}
}

func (h *userHandler) Login(ctx *gin.Context) {
	payload := Credentials{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	result, err := h.userService.Login(ctx, payload)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

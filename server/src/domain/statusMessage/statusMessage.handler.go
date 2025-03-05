package statusMessage

import (
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Handler interface {
		Get(ctx *gin.Context)
	}

	statusMessageHandler struct {
		statusMessageService Service
	}
)

func CreateHandler(userService Service) Handler {
	return &statusMessageHandler{
		statusMessageService: userService,
	}
}

func (h *statusMessageHandler) Get(ctx *gin.Context) {
	filter := StatusMessageFilter{
		Limit:  20,
		Offset: 0,
	}
	if err := ctx.BindQuery(&filter); err != nil {
	}

	// TODO: Add proper user ID from token
	result, err := h.statusMessageService.Get(ctx, user.NativeUserID, filter)
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.JSON(utils.OkResponse(result))
}

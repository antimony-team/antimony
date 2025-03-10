package user

import (
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
	"net/http"
)

type (
	Handler interface {
		LoginNative(ctx *gin.Context)
		LoginOIDC(ctx *gin.Context)
		LoginSuccess(ctx *gin.Context)
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

func (h *userHandler) LoginNative(ctx *gin.Context) {
	payload := CredentialsIn{}

	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.ErrorResponse(utils.ErrorInvalidCredentials))
		return
	}

	if result, err := h.userService.LoginNative(payload); err != nil {
		ctx.JSON(utils.ErrorResponse(err))
	} else {
		ctx.JSON(utils.OkResponse(result))
	}
}

func (h *userHandler) LoginOIDC(ctx *gin.Context) {
	url := h.userService.GetAuthCodeURL("")
	http.Redirect(ctx.Writer, ctx.Request, url, http.StatusFound)
}

func (h *userHandler) LoginSuccess(ctx *gin.Context) {
	token, err := h.userService.AuthenticateWithCode(ctx, ctx.Query("code"))
	if err != nil {
		ctx.JSON(utils.ErrorResponse(err))
		return
	}

	ctx.SetCookie("authToken", token, 0, "/", "", false, false)

	http.Redirect(ctx.Writer, ctx.Request, "http://localhost:8080", http.StatusFound)
}

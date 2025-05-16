package user

import (
	"antimonyBackend/utils"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"net/http"
)

type (
	Handler interface {
		Login(ctx *gin.Context)
		LoginCheck(ctx *gin.Context)
		Logout(ctx *gin.Context)
		LoginOIDC(ctx *gin.Context)
		LoginSuccess(ctx *gin.Context)
		RefreshToken(ctx *gin.Context)
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

func (h *userHandler) RefreshToken(ctx *gin.Context) {
	var (
		authToken, accessToken string
		err                    error
	)

	if authToken, err = ctx.Cookie("authToken"); err != nil {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrorUnauthorized))
		return
	}

	if accessToken, err = h.userService.RefreshAccessToken(authToken); err != nil {
		log.Error("Failed: %s, auth: %s", err.Error(), authToken)
		ctx.JSON(utils.CreateErrorResponse(utils.ErrorForbidden))
		return
	}

	ctx.SetCookie("accessToken", accessToken, 0, "/", "", false, false)

	ctx.JSON(utils.CreateOkResponse(accessToken))
}

func (h *userHandler) Login(ctx *gin.Context) {
	payload := CredentialsIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrorInvalidCredentials))
		return
	}

	if refreshToken, accessToken, err := h.userService.LoginNative(payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
	} else {
		ctx.SetCookie("authToken", refreshToken, 0, "/", "", false, true)
		ctx.SetCookie("accessToken", accessToken, 0, "/", "", false, false)
	}
}

func (h *userHandler) LoginCheck(ctx *gin.Context) {
	accessToken, err := ctx.Cookie("Authorization")
	if err != nil {
		ctx.JSON(200, gin.H{})
		return
	} else if !h.userService.IsTokenValid(accessToken) {
		ctx.JSON(401, gin.H{})
	} else {
		ctx.JSON(200, gin.H{})
	}
}

func (h *userHandler) Logout(ctx *gin.Context) {
	ctx.SetCookie("authToken", "", -1, "/", "", false, true)
	ctx.SetCookie("authOidc", "", -1, "/", "", false, false)
	ctx.SetCookie("accessToken", "", -1, "/", "", false, false)
}

func (h *userHandler) LoginOIDC(ctx *gin.Context) {
	url, err := h.userService.GetAuthCodeURL(ctx.Request.Referer())
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	http.Redirect(ctx.Writer, ctx.Request, url, http.StatusFound)
}

func (h *userHandler) LoginSuccess(ctx *gin.Context) {
	authToken, accessToken, err := h.userService.AuthenticateWithCode(ctx, ctx.Query("code"))
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.SetCookie("authToken", authToken, 0, "/", "", false, true)
	ctx.SetCookie("authOidc", "true", 0, "/", "", false, false)
	ctx.SetCookie("accessToken", accessToken, 0, "/", "", false, false)

	http.Redirect(ctx.Writer, ctx.Request, ctx.Query("state"), http.StatusFound)
}

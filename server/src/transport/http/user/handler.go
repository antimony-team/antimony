package user

import (
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *user.Service
}

func CreateHandler(service *user.Service) *Handler {
	return &Handler{
		service: service,
	}
}

// @Summary	Authenticate via native login
// @Accept		json
// @Tags		users
// @Success	200		{object}	nil
//
// @Failure	400		{object}	nil				"The provided credentials were invalid"
// @Failure	401		{object}	nil				"Authentication via native login is disabled"
// @Param		request	body		CredentialsIn	true	"The native credentials"
// @Router		/users/login/native [post]
func (h *Handler) LoginNative(ctx *gin.Context) {
	payload := user.CredentialsIn{}
	if err := ctx.Bind(&payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrInvalidCredentials))
		return
	}

	if refreshToken, accessToken, err := h.service.LoginNative(payload); err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
	} else {
		ctx.SetCookie("authToken", refreshToken, 0, "/", "", false, true)
		ctx.SetCookie("accessToken", accessToken, 0, "/", "", false, false)
	}
}

// @Summary	Authenticate via OpenID provider. Redirects the client to the OpenID provider page.
// @Accept		json
// @Tags		users
// @Success	302	{object}	nil
// @Failure	401	{object}	nil	"Authentication via OpenID is disabled"
// @Router		/users/login/openid [get]
func (h *Handler) LoginOpenId(ctx *gin.Context) {
	url, err := h.service.GetAuthCodeURL(ctx.Request.Referer())
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	http.Redirect(ctx.Writer, ctx.Request, url, http.StatusFound)
}

// @Summary	Redirect URL for the OpenID provider.
func (h *Handler) LoginOpenIdSuccess(ctx *gin.Context) {
	authToken, accessToken, err := h.service.AuthenticateWithCode(ctx, ctx.Query("code"))
	if err != nil {
		ctx.JSON(utils.CreateErrorResponse(err))
		return
	}

	ctx.SetCookie("authToken", authToken, 0, "/", "", false, true)
	ctx.SetCookie("authOidc", "true", 0, "/", "", false, false)
	ctx.SetCookie("accessToken", accessToken, 0, "/", "", false, false)

	http.Redirect(ctx.Writer, ctx.Request, ctx.Query("state"), http.StatusFound)
}

// @Summary	Logout and clear all authentication cookies
// @Tags		users
// @Success	200	{object}	nil
// @Router		/users/logout [post]
func (h *Handler) Logout(ctx *gin.Context) {
	ctx.SetCookie("authToken", "", -1, "/", "", false, true)
	ctx.SetCookie("authOidc", "", -1, "/", "", false, false)
	ctx.SetCookie("accessToken", "", -1, "/", "", false, false)
}

// @Summary	Get the server's authentication config
// @Accept		json
// @Produce	json
// @Tags		users
// @Success	200	{object}	utils.OkResponse[auth.AuthConfig]	"The authentication config of the server"
// @Router		/users/login/config [get]
func (h *Handler) AuthConfig(ctx *gin.Context) {
	ctx.JSON(utils.CreateOkResponse(h.service.GetAuthConfig()))
}

// @Summary	Refresh the access token
// @Tags		users
// @Success	200	{object}	utils.OkResponse[auth.AuthConfig]	"The authentication config of the server"
// @Failure	401	{object}	nil									"The auth token cookie is not set"
// @Failure	403	{object}	nil									"The provided auth token was invalid"
// @Router		/users/login/refresh [get]
func (h *Handler) RefreshToken(ctx *gin.Context) {
	var (
		authToken, accessToken string
		err                    error
	)

	if authToken, err = ctx.Cookie("authToken"); err != nil {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrUnauthorized))
		return
	}

	if accessToken, err = h.service.RefreshAccessToken(authToken); err != nil {
		ctx.JSON(utils.CreateErrorResponse(utils.ErrForbidden))
		return
	}

	ctx.SetCookie("accessToken", accessToken, 0, "/", "", false, false)

	ctx.JSON(utils.CreateOkResponse(accessToken))
}

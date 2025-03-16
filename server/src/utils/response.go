package utils

import (
	"errors"
	"net/http"
)

type Response struct {
	Payload any    `json:"payload,omitempty"`
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

func OkResponse(obj any) (int, Response) {
	return http.StatusOK, Response{Payload: obj}
}

func ErrorResponse(err error) (int, Response) {
	switch {
	case errors.Is(err, ErrorUuidNotFound):
		return http.StatusNotFound, Response{Code: -1, Message: err.Error()}
	case errors.Is(err, ErrorUnauthorized):
		return http.StatusUnauthorized, Response{Code: -1, Message: err.Error()}
	case errors.Is(err, ErrorInvalidCredentials):
		return http.StatusBadRequest, Response{Code: 1001, Message: err.Error()}
	case errors.Is(err, ErrorCollectionExists):
		return http.StatusBadRequest, Response{Code: 2001, Message: err.Error()}
	// Permission / Access errors
	case errors.Is(err, ErrorNoWriteAccessToLab),
		errors.Is(err, ErrorNoWriteAccessToTopology),
		errors.Is(err, ErrorNoWriteAccessToCollection),
		errors.Is(err, ErrorNoDeployAccessToCollection),
		errors.Is(err, ErrorNoPermissionToCreateCollections):
		return http.StatusForbidden, Response{Code: -1, Message: err.Error()}
	case errors.Is(err, ErrorTokenInvalid):
		return 498, Response{Code: -1, Message: err.Error()}
	default:
		return http.StatusInternalServerError, Response{Code: -1, Message: err.Error()}
	}
}

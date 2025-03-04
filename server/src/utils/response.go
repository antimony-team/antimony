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
		return http.StatusNotFound, Response{Code: 422, Message: err.Error()}
	default:
		return http.StatusInternalServerError, Response{Code: -1, Message: err.Error()}
	}
}

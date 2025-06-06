package utils

import (
	"errors"
	"net/http"
)

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type OkResponse[T any] struct {
	Payload T `json:"payload"`
}

func CreateOkResponse[T any](obj T) (int, OkResponse[T]) {
	return http.StatusOK, OkResponse[T]{Payload: obj}
}

func CreateErrorResponse(err error) (int, ErrorResponse) {
	switch {
	case errors.Is(err, ErrorUuidNotFound):
		return http.StatusNotFound, ErrorResponse{Code: -1, Message: err.Error()}
	case errors.Is(err, ErrorInvalidCredentials):
		return http.StatusBadRequest, ErrorResponse{Code: 1001, Message: err.Error()}
	case errors.Is(err, ErrorCollectionExists):
		return http.StatusBadRequest, ErrorResponse{Code: 2001, Message: err.Error()}
	case errors.Is(err, ErrorTopologyExists):
		return http.StatusBadRequest, ErrorResponse{Code: 3001, Message: err.Error()}
	case errors.Is(err, ErrorInvalidTopology):
		return http.StatusBadRequest, ErrorResponse{Code: 3003, Message: err.Error()}
	case errors.Is(err, ErrorBindFileExists):
		return http.StatusBadRequest, ErrorResponse{Code: 4001, Message: err.Error()}
	case errors.Is(err, ErrorDatabaseError):
		return http.StatusInternalServerError, ErrorResponse{Code: 500, Message: err.Error()}
	// Permission / Access errors
	case errors.Is(err, ErrorUnauthorized):
	case errors.Is(err, ErrorOpenIDAuthDisabledError):
	case errors.Is(err, ErrorNativeAuthDisabledError):
		return http.StatusUnauthorized, ErrorResponse{Code: 401, Message: err.Error()}
	case errors.Is(err, ErrorTokenInvalid):
		return 498, ErrorResponse{Code: 498, Message: err.Error()}
	case errors.Is(err, ErrorForbidden),
		errors.Is(err, ErrorNoWriteAccessToLab),
		errors.Is(err, ErrorNoWriteAccessToBindFile),
		errors.Is(err, ErrorNoWriteAccessToTopology),
		errors.Is(err, ErrorNoWriteAccessToCollection),
		errors.Is(err, ErrorNoDeployAccessToCollection),
		errors.Is(err, ErrorNoPermissionToCreateCollections):
		return http.StatusForbidden, ErrorResponse{Code: 403, Message: err.Error()}
	}

	return http.StatusInternalServerError, ErrorResponse{Code: 500, Message: err.Error()}
}

func CreateValidationError(err error) (int, ErrorResponse) {
	return http.StatusUnprocessableEntity, ErrorResponse{Code: 422, Message: err.Error()}
}

func CreateSocketErrorResponse(err error) ErrorResponse {
	switch {
	case errors.Is(err, ErrorContainerlab):
		return ErrorResponse{Code: 5001, Message: err.Error()}
	case errors.Is(err, ErrorLabActionInProgress):
		return ErrorResponse{Code: 5002, Message: err.Error()}
	case errors.Is(err, ErrorInvalidSocketRequest):
		return ErrorResponse{Code: 5422, Message: err.Error()}
	case errors.Is(err, ErrorUuidNotFound):
		return ErrorResponse{Code: 5404, Message: err.Error()}
	// Permission / Access errors
	case errors.Is(err, ErrorNoDeployAccessToCollection),
		errors.Is(err, ErrorNoDestroyAccessToLab):
		return ErrorResponse{Code: 5403, Message: err.Error()}
	default:
		return ErrorResponse{Code: -1, Message: err.Error()}
	}
}

func CreateSocketOkResponse[T any](obj T) OkResponse[T] {
	return OkResponse[T]{Payload: obj}
}

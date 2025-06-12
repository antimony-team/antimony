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
	case errors.Is(err, ErrUuidNotFound):
		return http.StatusNotFound, ErrorResponse{Code: -1, Message: err.Error()}
	case errors.Is(err, ErrInvalidCredentials):
		return http.StatusBadRequest, ErrorResponse{Code: 1001, Message: err.Error()}
	case errors.Is(err, ErrCollectionExists):
		return http.StatusBadRequest, ErrorResponse{Code: 2001, Message: err.Error()}
	case errors.Is(err, ErrTopologyExists):
		return http.StatusBadRequest, ErrorResponse{Code: 3001, Message: err.Error()}
	case errors.Is(err, ErrInvalidTopology):
		return http.StatusBadRequest, ErrorResponse{Code: 3003, Message: err.Error()}
	case errors.Is(err, ErrBindFileExists):
		return http.StatusBadRequest, ErrorResponse{Code: 4001, Message: err.Error()}
	case errors.Is(err, ErrInvalidBindFilePath):
		return http.StatusBadRequest, ErrorResponse{Code: 4002, Message: err.Error()}
	case errors.Is(err, ErrDatabaseError):
		return http.StatusInternalServerError, ErrorResponse{Code: 500, Message: err.Error()}
	// Permission / Access errors
	case errors.Is(err, ErrUnauthorized),
		errors.Is(err, ErrOpenIDAuthDisabledError),
		errors.Is(err, ErrNativeAuthDisabledError):
		return http.StatusUnauthorized, ErrorResponse{Code: 401, Message: err.Error()}
	case errors.Is(err, ErrTokenInvalid):
		return 498, ErrorResponse{Code: 498, Message: err.Error()}
	case errors.Is(err, ErrForbidden),
		errors.Is(err, ErrNoAccessToLab),
		errors.Is(err, ErrNoWriteAccessToLab),
		errors.Is(err, ErrNoWriteAccessToBindFile),
		errors.Is(err, ErrNoWriteAccessToTopology),
		errors.Is(err, ErrNoWriteAccessToCollection),
		errors.Is(err, ErrNoDeployAccessToCollection),
		errors.Is(err, ErrNoDeployAccessToLab),
		errors.Is(err, ErrNoPermissionToCreateCollections):
		return http.StatusForbidden, ErrorResponse{Code: 403, Message: err.Error()}
	}

	return http.StatusInternalServerError, ErrorResponse{Code: -1, Message: err.Error()}
}

func CreateValidationError(err error) (int, ErrorResponse) {
	return http.StatusUnprocessableEntity, ErrorResponse{Code: 422, Message: err.Error()}
}

func CreateSocketErrorResponse(err error) ErrorResponse {
	switch {
	case errors.Is(err, ErrAntimony):
		return ErrorResponse{Code: 5000, Message: err.Error()}
	case errors.Is(err, ErrContainerlab):
		return ErrorResponse{Code: 5001, Message: err.Error()}
	case errors.Is(err, ErrLabIsDeploying):
		return ErrorResponse{Code: 5002, Message: err.Error()}
	case errors.Is(err, ErrLabNotRunning):
		return ErrorResponse{Code: 5003, Message: err.Error()}
	case errors.Is(err, ErrNodeNotRunning):
		return ErrorResponse{Code: 5004, Message: err.Error()}
	case errors.Is(err, ErrUuidNotFound):
		return ErrorResponse{Code: 5005, Message: err.Error()}
	case errors.Is(err, ErrNodeNotFound):
		return ErrorResponse{Code: 5006, Message: err.Error()}
	case errors.Is(err, ErrShellNotFound):
		return ErrorResponse{Code: 5007, Message: err.Error()}
	case errors.Is(err, ErrShellLimitReached):
		return ErrorResponse{Code: 5008, Message: err.Error()}
	case errors.Is(err, ErrInvalidSocketRequest):
		return ErrorResponse{Code: 5422, Message: err.Error()}
	// Permission / Access errors
	case errors.Is(err, ErrNoDeployAccessToCollection):
	case errors.Is(err, ErrNoDestroyAccessToLab):
	case errors.Is(err, ErrNoAccessToShell):
	case errors.Is(err, ErrNoAccessToLab):
		return ErrorResponse{Code: 5403, Message: err.Error()}
	}

	return ErrorResponse{Code: -1, Message: err.Error()}
}

func CreateSocketOkResponse[T any](obj T) OkResponse[T] {
	return OkResponse[T]{Payload: obj}
}

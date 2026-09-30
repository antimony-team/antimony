package utils

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCreateOkResponse_WrapsThePayload(t *testing.T) {
	status, response := CreateOkResponse("hello")

	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, "hello", response.Payload)
}

func TestCreateOkResponse_SupportsANilPayload(t *testing.T) {
	status, response := CreateOkResponse[any](nil)

	assert.Equal(t, http.StatusOK, status)
	assert.Nil(t, response.Payload)
}

func TestCreateValidationError_IsAlways422(t *testing.T) {
	status, response := CreateValidationError(errors.New("field is required"))

	assert.Equal(t, http.StatusUnprocessableEntity, status)
	assert.Equal(t, 422, response.Code)
	assert.Equal(t, "field is required", response.Message)
}

func TestCreateSocketOkResponse_WrapsThePayload(t *testing.T) {
	response := CreateSocketOkResponse("payload")

	assert.Equal(t, "payload", response.Payload)
}

/*
 * CreateErrorResponse
 */

func TestCreateErrorResponse_MapsEveryKnownError(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		code   int
	}{
		{"uuid not found", ErrUuidNotFound, http.StatusNotFound, -1},
		{"invalid credentials", ErrInvalidCredentials, http.StatusBadRequest, 1001},
		{"collection exists", ErrCollectionExists, http.StatusBadRequest, 2001},
		{"topology exists", ErrTopologyExists, http.StatusBadRequest, 3001},
		{"invalid topology", ErrInvalidTopology, http.StatusBadRequest, 3003},
		{"bind file exists", ErrBindFileExists, http.StatusBadRequest, 4001},
		{"invalid bind file path", ErrInvalidBindFilePath, http.StatusBadRequest, 4002},
		{"database error", ErrDatabaseError, http.StatusInternalServerError, 500},
		{"unauthorized", ErrUnauthorized, http.StatusUnauthorized, 401},
		{"openid disabled", ErrOpenIDAuthDisabledError, http.StatusUnauthorized, 401},
		{"native disabled", ErrNativeAuthDisabledError, http.StatusUnauthorized, 401},
		{"token invalid", ErrTokenInvalid, 498, 498},
		{"forbidden", ErrForbidden, http.StatusForbidden, 403},
		{"no access to lab", ErrNoAccessToLab, http.StatusForbidden, 403},
		{"no write access to lab", ErrNoWriteAccessToLab, http.StatusForbidden, 403},
		{"no write access to bind file", ErrNoWriteAccessToBindFile, http.StatusForbidden, 403},
		{"no write access to topology", ErrNoWriteAccessToTopology, http.StatusForbidden, 403},
		{"no write access to collection", ErrNoWriteAccessToCollection, http.StatusForbidden, 403},
		{"no deploy access to collection", ErrNoDeployAccessToCollection, http.StatusForbidden, 403},
		{"no deploy access to lab", ErrNoDeployAccessToLab, http.StatusForbidden, 403},
		{"cannot create collections", ErrNoPermissionToCreateCollections, http.StatusForbidden, 403},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			status, response := CreateErrorResponse(testCase.err)

			assert.Equal(t, testCase.status, status)
			assert.Equal(t, testCase.code, response.Code)
			assert.Equal(t, testCase.err.Error(), response.Message)
		})
	}
}

func TestCreateErrorResponse_MatchesWrappedErrors(t *testing.T) {
	wrapped := fmt.Errorf("%w: while saving the topology", ErrInvalidTopology)

	status, response := CreateErrorResponse(wrapped)

	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, 3003, response.Code)
	assert.Contains(t, response.Message, "while saving the topology")
}

func TestCreateErrorResponse_UnknownErrorsBecomeInternalServerErrors(t *testing.T) {
	status, response := CreateErrorResponse(errors.New("something nobody mapped"))

	assert.Equal(t, http.StatusInternalServerError, status)
	assert.Equal(t, -1, response.Code)
}

// TestCreateErrorResponse_UnmappedDomainErrorsLeakAs500 records which real domain errors have no
// HTTP mapping and therefore surface as a bare 500 with code -1.
//
// The two that matter for the API surface are ErrLabRunning (returned when a client tries to edit
// or delete a running lab, which is a client mistake and should be a 4xx — 409 would fit) and
// ErrNodeNotFound. The rest are genuine server-side failures where a 500 is defensible.
func TestCreateErrorResponse_UnmappedDomainErrorsLeakAs500(t *testing.T) {
	unmapped := []error{
		ErrLabRunning,
		ErrNodeNotFound,
		ErrAntimony,
		ErrProvider,
		ErrFileStorage,
		ErrOpenIDError,
		ErrLabNotFound,
		ErrLabNotRunning,
		ErrShellNotFound,
		ErrShellLimitReached,
		ErrNodeNotRunning,
		ErrLabOperationInProgress,
		ErrInvalidNodeOperation,
		ErrInvalidRuntimeCommand,
		ErrNoAccessToShell,
		ErrNoDestroyAccessToLab,
		ErrInvalidSocketRequest,
	}

	for _, err := range unmapped {
		t.Run(err.Error(), func(t *testing.T) {
			status, response := CreateErrorResponse(err)

			assert.Equal(t, http.StatusInternalServerError, status)
			assert.Equal(t, -1, response.Code)
		})
	}
}

/*
 * CreateSocketErrorResponse
 */

func TestCreateSocketErrorResponse_MapsEveryKnownError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"antimony", ErrAntimony, 5000},
		{"provider", ErrProvider, 5001},
		{"invalid runtime command", ErrInvalidRuntimeCommand, 5400},
		{"invalid socket request", ErrInvalidSocketRequest, 5422},
		{"uuid not found", ErrUuidNotFound, 5404},

		// Lab errors.
		{"lab not found", ErrLabNotFound, 5011},
		{"lab not running", ErrLabNotRunning, 5012},
		{"lab operation in progress", ErrLabOperationInProgress, 5013},

		// Node errors.
		{"node not found", ErrNodeNotFound, 5021},
		{"node not running", ErrNodeNotRunning, 5022},
		{"invalid node operation", ErrInvalidNodeOperation, 5023},

		// Shell errors.
		{"shell not found", ErrShellNotFound, 5031},
		{"shell limit reached", ErrShellLimitReached, 5032},

		// Permission errors.
		{"no destroy access to lab", ErrNoDestroyAccessToLab, 5403},
		{"no access to shell", ErrNoAccessToShell, 5403},
		{"no access to lab", ErrNoAccessToLab, 5403},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := CreateSocketErrorResponse(testCase.err)

			assert.Equal(t, testCase.code, response.Code)
			assert.Equal(t, testCase.err.Error(), response.Message)
		})
	}
}

func TestCreateSocketErrorResponse_MatchesWrappedErrors(t *testing.T) {
	// The node commands wrap this error with a reason, which is the form clients actually receive.
	wrapped := fmt.Errorf("%w: node is already running", ErrInvalidNodeOperation)

	response := CreateSocketErrorResponse(wrapped)

	assert.Equal(t, 5023, response.Code)
	assert.Contains(t, response.Message, "node is already running")
}

func TestCreateSocketErrorResponse_UnknownErrorsFallBackTo5000(t *testing.T) {
	response := CreateSocketErrorResponse(errors.New("nobody mapped this either"))

	assert.Equal(t, 5000, response.Code)
	assert.Equal(t, "nobody mapped this either", response.Message)
}

// TestCreateSocketErrorResponse_LabAndNodeNotFoundAreDistinct guards the fix for a copy-paste bug:
// the lab-errors block used to start with ErrNodeNotFound, which stole 5011 from ErrLabNotFound and
// made the 5021 case below it unreachable.
func TestCreateSocketErrorResponse_LabAndNodeNotFoundAreDistinct(t *testing.T) {
	labCode := CreateSocketErrorResponse(ErrLabNotFound).Code
	nodeCode := CreateSocketErrorResponse(ErrNodeNotFound).Code

	assert.Equal(t, 5011, labCode)
	assert.Equal(t, 5021, nodeCode)
	assert.NotEqual(t, labCode, nodeCode, "a missing lab and a missing node must be distinguishable")
}

func TestCreateSocketErrorResponse_PermissionErrorsShareOneCode(t *testing.T) {
	for _, err := range []error{ErrNoDestroyAccessToLab, ErrNoAccessToShell, ErrNoAccessToLab} {
		assert.Equal(t, 5403, CreateSocketErrorResponse(err).Code)
	}
}

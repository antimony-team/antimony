package test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * The "data" event contract.
 *
 * socket.namespace.handleData requires the payload to arrive as a single JSON-encoded *string*
 * rather than as a socket.io object, unmarshals it into the namespace's input type and dispatches to
 * the namespace's onData handler. Everything it rejects comes back as 5422.
 */

func TestSocketProtocol_NoArgumentsIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.EmitArgs().RequireError(5422)
	assert.Contains(t, errorResponse.Message, "no data provided")
}

func TestSocketProtocol_ANonStringPayloadIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	t.Run("object", func(t *testing.T) {
		// Sending the command as a socket.io object rather than as a JSON string is the most
		// likely client mistake, so the error names the type it actually received.
		errorResponse := client.EmitArgs(map[string]any{"labId": LabAdminID, "command": cmdDeployLab}).
			RequireError(5422)

		assert.Contains(t, errorResponse.Message, "expected a string payload")
	})

	t.Run("number", func(t *testing.T) {
		errorResponse := client.EmitArgs(42).RequireError(5422)

		assert.Contains(t, errorResponse.Message, "expected a string payload")
	})

	t.Run("boolean", func(t *testing.T) {
		client.EmitArgs(true).RequireError(5422)
	})

	t.Run("array", func(t *testing.T) {
		client.EmitArgs([]any{1, 2, 3}).RequireError(5422)
	})
}

func TestSocketProtocol_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, payload := range map[string]string{
		"truncated object": `{"labId":`,
		"not json at all":  `hello`,
		"empty string":     ``,
		"bare identifier":  `undefined`,
	} {
		t.Run(name, func(t *testing.T) {
			errorResponse := client.EmitRaw(payload).RequireError(5422)

			assert.Contains(t, errorResponse.Message, "invalid JSON payload")
		})
	}
}

func TestSocketProtocol_JsonOfTheWrongShapeIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, payload := range map[string]string{
		"a json array":  `[1,2,3]`,
		"a json string": `"just a string"`,
		"a json number": `42`,
	} {
		t.Run(name, func(t *testing.T) {
			// These are valid JSON but do not unmarshal into a commandPayload struct.
			client.EmitRaw(payload).RequireError(5422)
		})
	}
}

func TestSocketProtocol_MissingCommandFieldsAreRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, payload := range map[string]map[string]any{
		"no command":      {"labId": LabAdminID},
		"no lab":          {"command": cmdDeployLab},
		"null command":    {"labId": LabAdminID, "command": nil},
		"null lab":        {"labId": nil, "command": cmdDeployLab},
		"empty object":    {},
		"unrelated field": {"somethingElse": "value"},
	} {
		t.Run(name, func(t *testing.T) {
			// The handler requires both Command and LabId before it will dispatch anything.
			errorResponse := client.Emit(payload).RequireError(5422)

			assert.Contains(t, errorResponse.Message, "socket request was invalid")
		})
	}
}

func TestSocketProtocol_UnknownCommandIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for _, command := range []int{8, 42, -1, 9999} {
		errorResponse := client.Emit(map[string]any{
			"labId":   LabAdminID,
			"command": command,
		}).RequireError(5400)

		assert.Contains(t, errorResponse.Message, "runtime command was invalid")
	}
}

func TestSocketProtocol_ExtraFieldsAreIgnored(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// Unknown fields must not break decoding, so a newer client can talk to an older server.
	client.Emit(map[string]any{
		"labId":        LabAdminID,
		"command":      cmdDeployLab,
		"futureField":  "ignored",
		"anotherField": 123,
	}).RequireOk(nil)

	assert.True(t, h.Provider.WasCalled("Deploy"))
}

func TestSocketProtocol_ExtraArgumentsAfterThePayloadAreIgnored(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// Only the first argument is read; trailing ones are dropped (the ack callback is stripped
	// before the payload is inspected).
	client.EmitArgs(`{"labId":"`+LabAdminID+`","command":0}`, "extra", 99).RequireOk(nil)

	assert.True(t, h.Provider.WasCalled("Deploy"))
}

// TestSocketProtocol_EmittingWithoutAnAckIsSupported covers the ack-less emit path.
//
// socket.namespace.handleData deliberately supports an emit with no ack callback, but it used to
// pass nil for both onResponse and onError, and every command handler calls one of them
// unconditionally. That dereferenced a nil function value: the work completed and then the
// acknowledgement panicked, recovered by handleConnection. handleData now substitutes no-op
// callbacks so the handlers have something safe to call.
func TestSocketProtocol_EmittingWithoutAnAckIsSupported(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	client.EmitWithoutAck(deployCommand(LabAdminID))

	// The command must run to completion, with no panic along the way.
	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(LabAdminID)
	}, "an ack-less command must still be executed")

	assert.True(t, h.Provider.WasCalled("Deploy"))

	// And the side effects must be observable, which is how a client without an ack learns anything.
	var update instanceUpdatePayload
	updates.NextPayload(&update)
	require.NotNil(t, update.LabId)
	assert.Equal(t, LabAdminID, *update.LabId)

	// The connection must remain usable.
	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)
}

func TestSocketProtocol_AckLessFailuresDoNotBreakTheConnection(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// Destroying a lab that is not running fails with ErrLabNotRunning. With no ack there is nowhere
	// to report it, but the handler must not panic and the connection must survive.
	client.EmitWithoutAck(destroyCommand(LabAdminID))
	client.ExpectNoData()

	assert.False(t, h.Provider.WasCalled("Destroy"))

	// The very same command with an ack still reports the failure properly.
	client.Emit(destroyCommand(LabAdminID)).RequireError(5012)
}

func TestSocketProtocol_AckLessInvalidPayloadIsSafe(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// The reject path inside handleData already guarded against a nil ack; this makes sure the
	// handler-side callbacks are equally safe for a payload that gets as far as dispatch.
	client.EmitWithoutAck(map[string]any{"labId": LabAdminID, "command": 999})
	client.ExpectNoData()

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)
}

func TestSocketProtocol_AckIsDeliveredOncePerEmit(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// Several commands in sequence must each get their own answer, in order.
	first := client.Emit(deployCommand(LabAdminID))
	second := client.Emit(deployCommand("no-such-lab"))
	third := client.Emit(destroyCommand(LabAdminID))

	first.RequireOk(nil)
	second.RequireError(5011)
	third.RequireOk(nil)
}

func TestSocketProtocol_ErrorEnvelopeShape(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	ack := client.Emit(map[string]any{"labId": LabAdminID, "command": 999})

	require.True(t, ack.IsError(), "an error ack must be distinguishable from an ok ack")

	errorResponse := ack.RequireError(5400)
	assert.NotEmpty(t, errorResponse.Message)
	assert.NotZero(t, errorResponse.Code)
}

func TestSocketProtocol_OkEnvelopeShape(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// Commands that have nothing to return answer with a null payload rather than omitting it.
	ack := client.Emit(fetchShellsCommand(LabAdminID))

	require.False(t, ack.IsError())
	assert.Contains(t, string(ack.Raw), "payload")
}

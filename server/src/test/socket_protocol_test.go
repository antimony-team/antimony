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

// TestSocketProtocol_EmittingWithoutAnAckPanicsInternally documents a robustness bug.
//
// socket.namespace.handleData deliberately supports an ack-less emit:
//
//	if ack != nil { m.onData(ctx, &data, authUser, onResponse, onError) }
//	else          { m.onData(ctx, &data, authUser, nil, nil) }
//
// but every command handler calls onResponse or onError unconditionally, so passing nil for both
// dereferences a nil function value. The callbacks are invoked *after* the command has run, so the
// work itself still happens — it is only the acknowledgement that blows up. The panic is swallowed
// by the recover in handleConnection, so the server survives and the connection stays usable.
//
// The visible consequences are a recovered panic in the logs for every ack-less emit and, worse, a
// silently discarded failure: a command that errors panics on onError, so nothing is recorded
// anywhere that the client could learn from.
//
// Either the handlers should nil-check their callbacks (shell.handleUserData already does for
// onError), or handleData should pass no-op callbacks rather than nil.
func TestSocketProtocol_EmittingWithoutAnAckPanicsInternally(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// A deploy with no ack callback. The deployment runs to completion and the handler then panics
	// trying to acknowledge it.
	client.EmitWithoutAck(deployCommand(LabAdminID))

	// Give the server a moment to process (and recover from) the emit.
	client.ExpectNoData()

	assert.True(t, h.Provider.WasCalled("Deploy"),
		"the command's work completes before the acknowledgement panics")
	assert.True(t, h.InstanceService.IsRunning(LabAdminID))

	// The connection must still be usable afterwards, which is what the recover buys.
	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)
	assert.True(t, h.Provider.WasCalled("Destroy"))
}

// TestSocketProtocol_AckLessFailuresAreSwallowedSilently is the damaging half of the bug above: a
// command that fails without an ack callback reports its failure nowhere at all.
func TestSocketProtocol_AckLessFailuresAreSwallowedSilently(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	// Destroying a lab that is not running fails with ErrLabNotRunning, which would normally come
	// back as 5012. With no ack, onError panics instead and the client learns nothing.
	client.EmitWithoutAck(destroyCommand(LabAdminID))

	updates.ExpectNoData()
	assert.False(t, h.Provider.WasCalled("Destroy"))
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

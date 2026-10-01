package test

import (
	"antimonyBackend/utils"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	clienttransports "github.com/zishang520/socket.io/clients/engine/v3/transports"
	clientsocket "github.com/zishang520/socket.io/clients/socket/v3"
	siotypes "github.com/zishang520/socket.io/v3/pkg/types"
)

const (
	// socketTimeout is how long a test waits for an expected socket event or ack.
	socketTimeout = 5 * time.Second

	// socketQuietPeriod is how long a test waits before concluding that nothing is going to arrive.
	socketQuietPeriod = 400 * time.Millisecond
)

// errSocketConnect reports a namespace middleware rejection.
var errSocketConnect = errors.New("socket connect error")

// SocketClient is a connected socket.io test client for a single namespace.
//
// Event listeners are registered before the connection is awaited, so nothing emitted by the server
// during connection setup (the backlog replay, for instance) can be missed.
type SocketClient struct {
	T         *testing.T
	Namespace string

	socket *clientsocket.Socket

	data    chan any
	backlog chan any

	disconnected chan struct{}

	closeOnce sync.Once
}

// SocketAck is the acknowledgement the server sent in response to a "data" event.
type SocketAck struct {
	T *testing.T

	// Raw is the ack argument re-encoded as JSON. Nil when the server never acked.
	Raw json.RawMessage
}

/*
 * Dialing.
 */

// Dial connects to an authenticated namespace and fails the test if the connection cannot be
// established.
//
// Reconnection is deliberately off on the client so TryDial can observe a namespace rejection
// exactly once, which also means a transient transport error would be fatal. Running the whole
// suite stands up many concurrent servers and the polling transport does occasionally fail to hand
// over, so this must-succeed path retries. TryDial does not, because there a refusal is the point.
func (h *Harness) Dial(namespace string, token string) *SocketClient {
	h.T.Helper()

	const attempts = 3

	var lastErr error

	for attempt := range attempts {
		client, err := h.TryDial(namespace, token)
		if err == nil {
			return client
		}

		lastErr = err

		if attempt < attempts-1 {
			time.Sleep(50 * time.Millisecond)
		}
	}

	require.NoErrorf(h.T, lastErr, "expected to connect to namespace %q", namespace)

	return nil
}

// DialAnonymous connects without an auth payload, for anonymous namespaces.
func (h *Harness) DialAnonymous(namespace string) *SocketClient {
	h.T.Helper()

	client, err := h.tryDial(namespace, nil)
	require.NoErrorf(h.T, err, "expected to connect to anonymous namespace %q", namespace)

	return client
}

// TryDial attempts to connect and returns the server's rejection instead of failing the test.
func (h *Harness) TryDial(namespace string, token string) (*SocketClient, error) {
	h.T.Helper()

	return h.tryDial(namespace, map[string]any{"token": token})
}

// TryDialWithAuth attempts to connect with an arbitrary handshake auth payload, for tests that send
// a malformed one.
func (h *Harness) TryDialWithAuth(namespace string, authPayload map[string]any) (*SocketClient, error) {
	h.T.Helper()

	return h.tryDial(namespace, authPayload)
}

func (h *Harness) tryDial(namespace string, authPayload map[string]any) (*SocketClient, error) {
	h.T.Helper()

	opts := clientsocket.DefaultOptions()

	// WebSocket only, rather than the default polling-then-upgrade. The upgrade dance adds a
	// long-poll request per connection, and under the load of the whole suite those occasionally
	// fail to hand over, which silently wedges an otherwise healthy connection.
	opts.SetTransports(siotypes.NewSet(clienttransports.WebSocket))
	opts.SetForceNew(true)

	// Reconnection keeps an established connection alive across a transport hiccup. It does not
	// interfere with observing a namespace rejection: connect_error still fires once before any
	// retry, and TryDial closes the client as soon as it sees it.
	opts.SetReconnection(true)
	opts.SetReconnectionAttempts(3)
	opts.SetReconnectionDelay(20)

	// Connect explicitly rather than on construction, so every listener is attached before the
	// server can emit anything. The backlog replay in particular is sent from handleConnection, and
	// a listener registered after the fact would miss it.
	opts.SetAutoConnect(false)

	if authPayload != nil {
		opts.SetAuth(authPayload)
	}

	socket, err := clientsocket.Connect(h.Server.URL+normalizeNamespace(namespace), opts)
	if err != nil {
		return nil, err
	}

	client := &SocketClient{
		T:            h.T,
		Namespace:    namespace,
		socket:       socket,
		data:         make(chan any, 256),
		backlog:      make(chan any, 8),
		disconnected: make(chan struct{}),
	}

	var disconnectOnce sync.Once

	socket.On("disconnect", func(...any) {
		disconnectOnce.Do(func() { close(client.disconnected) })
	})

	connected := make(chan struct{})
	connectFailed := make(chan error, 1)

	var connectOnce sync.Once

	socket.On("connect", func(...any) {
		connectOnce.Do(func() { close(connected) })
	})

	socket.On("connect_error", func(args ...any) {
		select {
		case connectFailed <- fmt.Errorf("%w: %s", errSocketConnect, describeSocketError(args)):
		default:
		}
	})

	socket.On("data", func(args ...any) {
		if len(args) > 0 {
			select {
			case client.data <- args[0]:
			default:
			}
		}
	})

	socket.On("backlog", func(args ...any) {
		if len(args) > 0 {
			select {
			case client.backlog <- args[0]:
			default:
			}
		}
	})

	h.T.Cleanup(client.Close)

	socket.Connect()

	select {
	case <-connected:
		return client, nil
	case err := <-connectFailed:
		client.Close()
		return nil, err
	case <-time.After(socketTimeout):
		client.Close()
		return nil, fmt.Errorf("%w: timed out connecting to %q", errSocketConnect, namespace)
	}
}

// RawConnectError performs the socket.io namespace handshake over a bare websocket and returns the
// reason the server gives for refusing the connection, or "" when it accepts it.
//
// The Go client cannot observe the reason: its parser rejects the server's connect_error packet
// because the packet's `data` field is null. The browser client accepts it, and data-binder.ts in
// the interface branches on the exact text, so the reason is read straight off the wire here.
func (h *Harness) RawConnectError(namespace string, authPayload map[string]any) string {
	h.T.Helper()

	url := "ws" + strings.TrimPrefix(h.Server.URL, "http") + "/socket.io/?EIO=4&transport=websocket"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(h.T, err)
	defer conn.Close()

	require.NoError(h.T, conn.SetReadDeadline(time.Now().Add(socketTimeout)))

	_, open, err := conn.ReadMessage()
	require.NoError(h.T, err)
	require.Truef(h.T, strings.HasPrefix(string(open), "0"), "expected an engine.io open packet, got %q", open)

	// "4" is an engine.io message, "0" a socket.io CONNECT for the namespace, followed by the auth
	// payload the browser client sends from its `auth` option.
	connect := "40" + namespace + ","
	if authPayload != nil {
		encoded, err := json.Marshal(authPayload)
		require.NoError(h.T, err)
		connect += string(encoded)
	}
	require.NoError(h.T, conn.WriteMessage(websocket.TextMessage, []byte(connect)))

	accepted := "40" + namespace + ","
	refused := "44" + namespace + ","

	for {
		_, msg, err := conn.ReadMessage()
		require.NoError(h.T, err)

		switch packet := string(msg); {
		case strings.HasPrefix(packet, accepted):
			return ""
		case strings.HasPrefix(packet, refused):
			var connectError struct {
				Message string `json:"message"`
			}
			require.NoError(h.T, json.Unmarshal([]byte(strings.TrimPrefix(packet, refused)), &connectError))

			return connectError.Message
		}
	}
}

// Close disconnects the client. It is safe to call more than once and is registered with t.Cleanup.
func (c *SocketClient) Close() {
	c.closeOnce.Do(func() { c.socket.Close() })
}

/*
 * Emitting.
 */

// Emit JSON-encodes the payload and sends it as a "data" event, waiting for the ack.
//
// The namespace layer requires the payload to arrive as a JSON *string* rather than as an object,
// so the encoding step here is part of the contract under test.
func (c *SocketClient) Emit(payload any) SocketAck {
	c.T.Helper()

	encoded, err := json.Marshal(payload)
	require.NoError(c.T, err)

	return c.EmitArgs(string(encoded))
}

// EmitRaw sends a verbatim string payload, for malformed-JSON tests.
func (c *SocketClient) EmitRaw(payload string) SocketAck {
	c.T.Helper()

	return c.EmitArgs(payload)
}

// EmitArgs sends arbitrary arguments with the "data" event, for tests that violate the payload
// contract on purpose (no arguments at all, or a non-string argument).
func (c *SocketClient) EmitArgs(args ...any) SocketAck {
	c.T.Helper()

	acked := make(chan []any, 1)

	c.socket.EmitWithAck("data", args...)(func(ackArgs []any, err error) {
		if err != nil {
			return
		}

		select {
		case acked <- ackArgs:
		default:
		}
	})

	select {
	case ackArgs := <-acked:
		if len(ackArgs) == 0 {
			return SocketAck{T: c.T}
		}

		encoded, err := json.Marshal(ackArgs[0])
		require.NoError(c.T, err)

		return SocketAck{T: c.T, Raw: encoded}
	case <-time.After(socketTimeout):
		c.T.Fatalf("timed out waiting for an ack on namespace %q", c.Namespace)
		return SocketAck{T: c.T}
	}
}

// TryEmit behaves like Emit but reports a missing acknowledgement instead of failing the test.
//
// Use it from a goroutine: testing.T.Fatalf may only be called from the goroutine running the test,
// so the fatal path inside Emit would itself be a violation.
func (c *SocketClient) TryEmit(payload any) (SocketAck, bool) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return SocketAck{T: c.T}, false
	}

	acked := make(chan []any, 1)

	c.socket.EmitWithAck("data", string(encoded))(func(ackArgs []any, err error) {
		if err != nil {
			return
		}

		select {
		case acked <- ackArgs:
		default:
		}
	})

	select {
	case ackArgs := <-acked:
		if len(ackArgs) == 0 {
			return SocketAck{T: c.T}, true
		}

		raw, err := json.Marshal(ackArgs[0])
		if err != nil {
			return SocketAck{T: c.T}, false
		}

		return SocketAck{T: c.T, Raw: raw}, true
	case <-time.After(socketTimeout):
		return SocketAck{T: c.T}, false
	}
}

// EmitRawWithoutAck sends a verbatim string payload and does not wait for an acknowledgement.
//
// The shell data namespace only answers on failure (shell.handleUserData calls onError but never
// onResponse), so waiting for an ack after a successful write would block until the timeout.
func (c *SocketClient) EmitRawWithoutAck(payload string) {
	c.T.Helper()

	require.NoError(c.T, c.socket.Emit("data", payload))
}

// EmitWithoutAck sends a "data" event with no ack callback, exercising the path where the namespace
// has nothing to respond to.
func (c *SocketClient) EmitWithoutAck(payload any) {
	c.T.Helper()

	encoded, err := json.Marshal(payload)
	require.NoError(c.T, err)

	require.NoError(c.T, c.socket.Emit("data", string(encoded)))
}

/*
 * Receiving.
 */

// NextData waits for the next "data" event and returns its first argument.
func (c *SocketClient) NextData() any {
	c.T.Helper()

	value, ok := c.NextDataWithin(socketTimeout)
	require.Truef(c.T, ok, "timed out waiting for a data event on namespace %q", c.Namespace)

	return value
}

// NextDataWithin waits up to the given duration for a "data" event.
func (c *SocketClient) NextDataWithin(timeout time.Duration) (any, bool) {
	c.T.Helper()

	select {
	case value := <-c.data:
		return value, true
	case <-time.After(timeout):
		return nil, false
	}
}

// ExpectNoData asserts that nothing arrives on the namespace for a short quiet period.
func (c *SocketClient) ExpectNoData() {
	c.T.Helper()

	if value, ok := c.NextDataWithin(socketQuietPeriod); ok {
		c.T.Fatalf("expected no data on namespace %q but received %#v", c.Namespace, value)
	}
}

// NextPayload waits for a wrapped data event ({"payload": ...}) and decodes the payload into out.
func (c *SocketClient) NextPayload(out any) {
	c.T.Helper()

	DecodePayload(c.T, c.NextData(), out)
}

// NextRaw waits for an unwrapped data event and decodes it into out.
func (c *SocketClient) NextRaw(out any) {
	c.T.Helper()

	decodeInto(c.T, c.NextData(), out)
}

// NextBacklog waits for the backlog replay the server sends on connection.
func (c *SocketClient) NextBacklog() any {
	c.T.Helper()

	select {
	case value := <-c.backlog:
		return value
	case <-time.After(socketTimeout):
		c.T.Fatalf("timed out waiting for a backlog event on namespace %q", c.Namespace)
		return nil
	}
}

// ExpectNoBacklog asserts that the server does not replay a backlog on this namespace.
func (c *SocketClient) ExpectNoBacklog() {
	c.T.Helper()

	select {
	case value := <-c.backlog:
		c.T.Fatalf("expected no backlog on namespace %q but received %#v", c.Namespace, value)
	case <-time.After(socketQuietPeriod):
	}
}

// CollectData waits for exactly count data events and returns them in arrival order.
//
// Arrival order is not the same as send order: see
// TestSocketStreams_DeliveryOrderIsNotGuaranteed. Assert on the set of messages, not the sequence.
func (c *SocketClient) CollectData(count int) []any {
	c.T.Helper()

	out := make([]any, 0, count)

	for range count {
		value, ok := c.NextDataWithin(socketTimeout)
		require.Truef(
			c.T, ok, "timed out waiting for data event %d of %d on namespace %q",
			len(out)+1, count, c.Namespace,
		)

		out = append(out, value)
	}

	return out
}

// CollectPayloads waits for count wrapped data events and decodes each one into a T.
func CollectPayloads[T any](c *SocketClient, count int) []T {
	c.T.Helper()

	values := c.CollectData(count)

	out := make([]T, 0, len(values))
	for _, value := range values {
		var decoded T
		DecodePayload(c.T, value, &decoded)

		out = append(out, decoded)
	}

	return out
}

// DrainData returns every data event received so far without waiting.
func (c *SocketClient) DrainData() []any {
	c.T.Helper()

	out := make([]any, 0)

	for {
		select {
		case value := <-c.data:
			out = append(out, value)
		default:
			return out
		}
	}
}

/*
 * Ack assertions.
 */

// IsError reports whether the ack carried an ErrorResponse rather than an OkResponse.
func (a SocketAck) IsError() bool {
	if a.Raw == nil {
		return false
	}

	var probe map[string]json.RawMessage
	if err := json.Unmarshal(a.Raw, &probe); err != nil {
		return false
	}

	_, hasCode := probe["code"]

	return hasCode
}

// RequireOk asserts the ack was an OkResponse and decodes its payload into out. Pass nil for out
// when the command answers with a null payload.
func (a SocketAck) RequireOk(out any) {
	a.T.Helper()

	require.NotNil(a.T, a.Raw, "expected an ack from the server")
	require.Falsef(a.T, a.IsError(), "expected an ok response but got an error: %s", string(a.Raw))

	if out == nil {
		return
	}

	var envelope utils.OkResponse[json.RawMessage]
	require.NoErrorf(
		a.T, json.Unmarshal(a.Raw, &envelope),
		"ack is not an OkResponse envelope: %s", string(a.Raw),
	)

	require.NoErrorf(
		a.T, json.Unmarshal(envelope.Payload, out),
		"failed to decode ack payload: %s", string(envelope.Payload),
	)
}

// RequireError asserts the ack was an ErrorResponse with the given Antimony socket error code.
func (a SocketAck) RequireError(code int) utils.ErrorResponse {
	a.T.Helper()

	require.NotNil(a.T, a.Raw, "expected an ack from the server")
	require.Truef(a.T, a.IsError(), "expected an error response but got: %s", string(a.Raw))

	var errorResponse utils.ErrorResponse
	require.NoError(a.T, json.Unmarshal(a.Raw, &errorResponse))

	assert.Equalf(a.T, code, errorResponse.Code, "unexpected socket error code: %s", string(a.Raw))

	return errorResponse
}

/*
 * Decoding helpers.
 */

// DecodePayload decodes a wrapped data event ({"payload": ...}) into out.
func DecodePayload(t *testing.T, value any, out any) {
	t.Helper()

	encoded, err := json.Marshal(value)
	require.NoError(t, err)

	var envelope utils.OkResponse[json.RawMessage]
	require.NoErrorf(t, json.Unmarshal(encoded, &envelope), "not a wrapped payload: %s", string(encoded))
	require.NoErrorf(t, json.Unmarshal(envelope.Payload, out), "failed to decode payload: %s", string(envelope.Payload))
}

// decodeInto re-encodes an arbitrary socket.io argument and decodes it into out.
func decodeInto(t *testing.T, value any, out any) {
	t.Helper()

	encoded, err := json.Marshal(value)
	require.NoError(t, err)

	require.NoErrorf(t, json.Unmarshal(encoded, out), "failed to decode socket value: %s", string(encoded))
}

// SocketBytes coerces a raw socket.io argument into bytes. Binary payloads may arrive as a []byte,
// as a base64 string or as a JSON array of numbers depending on the transport, so all three are
// accepted.
func SocketBytes(t *testing.T, value any) []byte {
	t.Helper()

	switch typed := value.(type) {
	case []byte:
		return typed
	case interface{ Bytes() []byte }:
		// Binary frames arrive as an engine.io *types.BytesBuffer, which JSON-encodes to "{}".
		return typed.Bytes()
	case string:
		if decoded, err := base64.StdEncoding.DecodeString(typed); err == nil {
			return decoded
		}

		return []byte(typed)
	}

	// Binary frames commonly arrive as a JSON array of byte values. encoding/json will not read
	// that into a []byte (it expects base64 there), so go through []int.
	if encoded, err := json.Marshal(value); err == nil {
		var numbers []int
		if err := json.Unmarshal(encoded, &numbers); err == nil {
			out := make([]byte, len(numbers))
			for i, number := range numbers {
				out[i] = byte(number)
			}

			return out
		}
	}

	t.Fatalf("cannot interpret socket value as bytes: %#v", value)

	return nil
}

// describeSocketError renders whatever the client handed to a connect_error listener.
func describeSocketError(args []any) string {
	if len(args) == 0 {
		return "no detail"
	}

	switch typed := args[0].(type) {
	case error:
		return typed.Error()
	case string:
		return typed
	}

	if encoded, err := json.Marshal(args[0]); err == nil {
		return string(encoded)
	}

	return fmt.Sprintf("%#v", args[0])
}

// normalizeNamespace turns a namespace path into the leading-slash form the client expects.
func normalizeNamespace(namespace string) string {
	if strings.HasPrefix(namespace, "/") {
		return namespace
	}

	return "/" + namespace
}

// WaitForDisconnect reports whether the server disconnected this client within the timeout.
func (c *SocketClient) WaitForDisconnect() bool {
	c.T.Helper()

	select {
	case <-c.disconnected:
		return true
	case <-time.After(socketTimeout):
		return false
	}
}

// NextBacklogWithin waits up to the given duration for a backlog replay.
func (c *SocketClient) NextBacklogWithin(timeout time.Duration) (any, bool) {
	c.T.Helper()

	select {
	case value := <-c.backlog:
		return value, true
	case <-time.After(timeout):
		return nil, false
	}
}

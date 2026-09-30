package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/statusmessage"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// streamMessage is the payload type for the namespaces these tests create directly.
type streamMessage struct {
	Text string `json:"text"`
}

/*
 * Production output namespaces.
 */

func TestSocketStreams_LabUpdatesReachEverySubscriber(t *testing.T) {
	h := NewHarness(t)

	admin := h.Dial("/lab-updates", h.Seed.Admin.Token)
	member := h.Dial("/lab-updates", h.Seed.Member.Token)
	outsider := h.Dial("/lab-updates", h.Seed.Outsider.Token)

	h.DeployLab(LabAdminID)

	// /lab-updates is a broadcast namespace with no per-user filtering, so everyone connected sees
	// every lab's updates regardless of their collection access.
	for _, client := range []*SocketClient{admin, member, outsider} {
		var update instanceUpdatePayload
		client.NextPayload(&update)

		require.NotNil(t, update.LabId)
		assert.Equal(t, LabAdminID, *update.LabId)
	}
}

func TestSocketStreams_StatusMessagesReachEverySubscriber(t *testing.T) {
	h := NewHarness(t)

	admin := h.Dial("/status-messages", h.Seed.Admin.Token)
	member := h.Dial("/status-messages", h.Seed.Member.Token)

	h.DeployLab(LabAdminID)

	for _, client := range []*SocketClient{admin, member} {
		messages := CollectPayloads[statusmessage.Message](client, 2)
		assert.Len(t, messages, 2)
	}
}

func TestSocketStreams_LabLogsAreRawStrings(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)

	// The lab log namespace uses raw output, so lines arrive unwrapped rather than inside a
	// payload envelope.
	var lines []string
	decodeInto(t, client.NextBacklog(), &lines)

	assert.NotEmpty(t, lines)
	for _, line := range lines {
		assert.NotContains(t, line, `"payload"`)
	}
}

func TestSocketStreams_ContainerLogsAreStreamedPerNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	node := h.Provider.Node(InstanceAdminLab, NodeHost)
	require.NotNil(t, node)
	require.NotEmpty(t, node.ContainerId)

	client := h.Dial("/logs/"+LabAdminID+"/"+node.ContainerId, h.Seed.Admin.Token)

	var received string

	requireEventually(t, func() bool {
		require.True(t, h.Provider.PushContainerLog(InstanceAdminLab, NodeHost, "container says hello"),
			"the instance service must have registered a log stream for the node")

		value, ok := client.NextDataWithin(200 * time.Millisecond)
		if !ok {
			return false
		}

		var line string
		decodeInto(t, value, &line)
		received = line

		return true
	}, "container output must reach a subscriber of the node's log namespace")

	assert.Equal(t, "container says hello", received)
}

func TestSocketStreams_ContainerLogsAreRegisteredForEveryNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// Every node gets its own stream, so a push must be accepted for both of them.
	assert.True(t, h.Provider.PushContainerLog(InstanceAdminLab, NodeHost, "host line"))
	assert.True(t, h.Provider.PushContainerLog(InstanceAdminLab, NodeSRL, "srl line"))

	assert.False(t, h.Provider.PushContainerLog(InstanceAdminLab, "no-such-node", "nope"))
}

func TestSocketStreams_NodeStatsArePublishedByTheMonitor(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// The monitor only starts watching a node once its startup listener marks it ready.
	requireEventually(t, func() bool {
		return h.Provider.WasCalled("ReadNodeStats")
	}, "the monitor must begin polling node stats")

	node := h.Provider.Node(InstanceAdminLab, NodeHost)
	require.NotNil(t, node)

	client := h.Dial("/stats/"+node.ContainerId, h.Seed.Admin.Token)

	// The monitor ticks once a second, and the stats namespace uses raw output.
	value, ok := client.NextDataWithin(3 * time.Second)
	require.True(t, ok, "a stats sample must be published within a few monitor ticks")

	var stats instance.NodeStats
	decodeInto(t, value, &stats)

	assert.InDelta(t, 12.5, stats.CPUUsagePercent, 0.01)
	assert.InDelta(t, float32(1<<20), stats.MemoryUsage, 1)
	assert.InDelta(t, float32(1<<30), stats.MemoryLimit, 1)
	assert.False(t, stats.Timestamp.IsZero())

	require.Contains(t, stats.Interfaces, "eth0")
	assert.Equal(t, 128, stats.Interfaces["eth0"].RxBps)
	assert.Equal(t, 256, stats.Interfaces["eth0"].TxBps)
}

func TestSocketStreams_MonitorStopsWatchingAFailedNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	requireEventually(t, func() bool {
		return h.Provider.WasCalled("ReadNodeStats")
	}, "the monitor must begin polling node stats")

	// Once the stats read starts failing the monitor drops the node from its list.
	h.Provider.SetStatsFn(func(string, string) (*deployment.NodeStats, error) {
		return nil, errFakeProvider
	})

	h.Provider.ResetCalls()

	requireEventually(t, func() bool {
		return h.Provider.WasCalled("ReadNodeStats")
	}, "at least one more poll must happen before the node is dropped")

	// After the failures the monitor must stop asking about it entirely.
	time.Sleep(1500 * time.Millisecond)
	h.Provider.ResetCalls()
	time.Sleep(1500 * time.Millisecond)

	assert.False(t, h.Provider.WasCalled("ReadNodeStats"),
		"a node whose stats cannot be read must be removed from the monitor")
}

/*
 * Namespace mechanics, exercised through namespaces the tests create directly.
 */

func TestSocketNamespace_SendReachesEverySubscriber(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-broadcast",
	)

	admin := h.Dial("/test-broadcast", h.Seed.Admin.Token)
	member := h.Dial("/test-broadcast", h.Seed.Member.Token)

	requireEventuallyDelivered(t, func() { namespace.Send(streamMessage{Text: "everyone"}) }, admin, member)
}

func TestSocketNamespace_SendToTargetsASingleUser(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-targeted",
	)

	admin := h.Dial("/test-targeted", h.Seed.Admin.Token)
	member := h.Dial("/test-targeted", h.Seed.Member.Token)

	// Keep sending until the addressed client has it, then prove the other one never did.
	requireEventually(t, func() bool {
		namespace.SendTo(streamMessage{Text: "for the admin"}, []string{h.Seed.Admin.ID()})

		_, ok := admin.NextDataWithin(200 * time.Millisecond)

		return ok
	}, "the addressed user must receive the message")

	member.ExpectNoData()
}

func TestSocketNamespace_SendToIgnoresUnknownUsers(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-unknown-target",
	)

	client := h.Dial("/test-unknown-target", h.Seed.Admin.Token)

	// An unconnected user ID is silently skipped rather than failing the send.
	assert.NotPanics(t, func() {
		namespace.SendTo(streamMessage{Text: "nobody"}, []string{"not-connected"})
	})

	client.ExpectNoData()
}

func TestSocketNamespace_SendToAdminsSkipsOtherUsers(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-admins",
	)

	admin := h.Dial("/test-admins", h.Seed.Admin.Token)
	member := h.Dial("/test-admins", h.Seed.Member.Token)

	requireEventually(t, func() bool {
		namespace.SendToAdmins(streamMessage{Text: "admins only"})

		_, ok := admin.NextDataWithin(200 * time.Millisecond)

		return ok
	}, "an admin must receive an admin-only message")

	member.ExpectNoData()
}

func TestSocketNamespace_WrappedOutputCarriesAPayloadEnvelope(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-wrapped",
	)

	client := h.Dial("/test-wrapped", h.Seed.Admin.Token)

	var decoded streamMessage

	requireEventually(t, func() bool {
		namespace.Send(streamMessage{Text: "wrapped"})

		value, ok := client.NextDataWithin(200 * time.Millisecond)
		if !ok {
			return false
		}

		DecodePayload(t, value, &decoded)

		return true
	}, "a wrapped namespace must deliver an envelope")

	assert.Equal(t, "wrapped", decoded.Text)
}

func TestSocketNamespace_RawOutputOmitsTheEnvelope(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, true, nil, "test-raw",
	)

	client := h.Dial("/test-raw", h.Seed.Admin.Token)

	var decoded streamMessage

	requireEventually(t, func() bool {
		namespace.Send(streamMessage{Text: "raw"})

		value, ok := client.NextDataWithin(200 * time.Millisecond)
		if !ok {
			return false
		}

		decodeInto(t, value, &decoded)

		return true
	}, "a raw namespace must deliver the value directly")

	assert.Equal(t, "raw", decoded.Text)
}

func TestSocketNamespace_BulkSendDeliversEveryMessage(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-bulk",
	)

	client := h.Dial("/test-bulk", h.Seed.Admin.Token)

	// Make sure the server has registered the subscriber before the batch goes out, so the whole
	// batch is delivered rather than partly landing in nothing.
	requireEventually(t, func() bool {
		namespace.Send(streamMessage{Text: "warmup"})

		_, ok := client.NextDataWithin(200 * time.Millisecond)

		return ok
	}, "the subscriber must be registered")

	// Drop any extra warmup messages that were still in flight.
	time.Sleep(100 * time.Millisecond)
	client.DrainData()

	namespace.SendBulk([]streamMessage{{Text: "one"}, {Text: "two"}, {Text: "three"}})

	// A wrapped namespace emits one event per message rather than a single batched one, so three
	// separate data events must arrive.
	messages := CollectPayloads[streamMessage](client, 3)

	texts := make([]string, 0, len(messages))
	for _, message := range messages {
		texts = append(texts, message.Text)
	}

	assert.ElementsMatch(t, []string{"one", "two", "three"}, texts)
}

func TestSocketNamespace_BacklogReplaysAndCanBeCleared(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false,
		&socket.BacklogConfig{Capacity: 10, Kind: utils.RingKindValue},
		false, nil, "test-backlog",
	)

	namespace.Send(streamMessage{Text: "before anyone connected"})

	first := h.Dial("/test-backlog", h.Seed.Admin.Token)

	// This is a wrapped namespace, so the backlog carries the same envelope as the live messages.
	// See TestSocketNamespace_BacklogMatchesTheLiveMessageShape.
	var replayed []utils.OkResponse[streamMessage]
	decodeInto(t, first.NextBacklog(), &replayed)

	require.Len(t, replayed, 1)
	assert.Equal(t, "before anyone connected", replayed[0].Payload.Text)

	namespace.ClearBacklog()

	second := h.Dial("/test-backlog", h.Seed.Admin.Token)

	var afterClear []utils.OkResponse[streamMessage]
	decodeInto(t, second.NextBacklog(), &afterClear)

	assert.Empty(t, afterClear, "clearing the backlog must leave a new subscriber with nothing")
}

func TestSocketNamespace_BacklogEvictsOldestBeyondCapacity(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false,
		&socket.BacklogConfig{Capacity: 3, Kind: utils.RingKindValue},
		false, nil, "test-backlog-capacity",
	)

	for _, text := range []string{"one", "two", "three", "four", "five"} {
		namespace.Send(streamMessage{Text: text})
	}

	client := h.Dial("/test-backlog-capacity", h.Seed.Admin.Token)

	var replayed []utils.OkResponse[streamMessage]
	decodeInto(t, client.NextBacklog(), &replayed)

	require.Len(t, replayed, 3)

	texts := make([]string, 0, len(replayed))
	for _, item := range replayed {
		texts = append(texts, item.Payload.Text)
	}

	assert.Equal(t, []string{"three", "four", "five"}, texts,
		"the backlog is a ring, so the oldest entries are evicted in order")
}

// TestSocketNamespace_BacklogMatchesTheLiveMessageShape covers the backlog envelope.
//
// namespace.sendTo stored the raw value in the ring but wrapped it for the live send, so the same
// namespace delivered {"payload": {...}} on "data" and a bare [{...}] on "backlog" — two shapes for
// one stream. The backlog now carries the same envelope the live messages do.
//
// No production namespace was affected: the wrapped ones all have a nil backlog config and the
// backlogged ones all use raw output. This keeps the two consistent for whoever combines them.
func TestSocketNamespace_BacklogMatchesTheLiveMessageShape(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false,
		&socket.BacklogConfig{Capacity: 5, Kind: utils.RingKindValue},
		false, nil, "test-backlog-shape",
	)

	namespace.Send(streamMessage{Text: "stored"})

	client := h.Dial("/test-backlog-shape", h.Seed.Admin.Token)

	// The backlog carries the same envelope as a live message.
	var replayed []utils.OkResponse[streamMessage]
	decodeInto(t, client.NextBacklog(), &replayed)

	require.Len(t, replayed, 1)
	assert.Equal(t, "stored", replayed[0].Payload.Text)

	var live streamMessage

	requireEventually(t, func() bool {
		namespace.Send(streamMessage{Text: "live"})

		value, ok := client.NextDataWithin(200 * time.Millisecond)
		if !ok {
			return false
		}

		DecodePayload(t, value, &live)

		return true
	}, "a live message must arrive wrapped")

	assert.Equal(t, "live", live.Text)
}

func TestSocketNamespace_RawNamespaceBacklogStaysUnwrapped(t *testing.T) {
	h := NewHarness(t)

	// A raw namespace must keep delivering bare values in both channels, which is what the log and
	// shell streams rely on.
	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false,
		&socket.BacklogConfig{Capacity: 5, Kind: utils.RingKindValue},
		true, nil, "test-raw-backlog",
	)

	namespace.Send(streamMessage{Text: "stored"})

	client := h.Dial("/test-raw-backlog", h.Seed.Admin.Token)

	var replayed []streamMessage
	decodeInto(t, client.NextBacklog(), &replayed)

	require.Len(t, replayed, 1)
	assert.Equal(t, "stored", replayed[0].Text)
}

func TestSocketNamespace_ReleaseDisconnectsSubscribers(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-release",
	)

	client := h.Dial("/test-release", h.Seed.Admin.Token)

	namespace.Release()

	assert.True(t, client.WaitForDisconnect(), "Release must disconnect every subscriber")
}

// TestSocketStreams_DeliveryOrderIsNotGuaranteed records a property of the socket layer that every
// consumer needs to know about.
//
// namespace.sendTo loops over its subscribers and calls socket.Emit for each one, and the emit is
// asynchronous, so messages sent in quick succession can be delivered out of order. Ten messages
// sent as A..J have been observed arriving as A, J, B, C, ... — nothing is dropped, but the
// sequence is not preserved.
//
// This matters for the log and status streams, where the frontend renders messages in arrival
// order: a burst of deployment output can appear scrambled. Anything that depends on ordering needs
// a sequence number or a timestamp in the payload. It is also why the tests in this suite assert on
// the set of messages received rather than on their order.
func TestSocketStreams_DeliveryOrderIsNotGuaranteed(t *testing.T) {
	h := NewHarness(t)

	namespace := socket.CreateOutputNamespace[streamMessage](
		h.Sockets, false, nil, false, nil, "test-ordering",
	)

	client := h.Dial("/test-ordering", h.Seed.Admin.Token)

	const count = 20

	sent := make([]string, 0, count)

	// Let the server finish registering the subscriber before the burst.
	requireEventually(t, func() bool {
		namespace.Send(streamMessage{Text: "warmup"})

		_, ok := client.NextDataWithin(200 * time.Millisecond)

		return ok
	}, "the subscriber must be registered")

	for i := range count {
		text := string(rune('a' + i))
		sent = append(sent, text)

		namespace.Send(streamMessage{Text: text})
	}

	received := make([]string, 0, count)

	requireEventually(t, func() bool {
		for {
			value, ok := client.NextDataWithin(100 * time.Millisecond)
			if !ok {
				break
			}

			var decoded streamMessage
			DecodePayload(t, value, &decoded)

			if decoded.Text != "warmup" {
				received = append(received, decoded.Text)
			}
		}

		return len(received) >= count
	}, "every message must arrive, even if out of order")

	// Nothing may be lost, which is the guarantee that does hold.
	assert.ElementsMatch(t, sent, received[:count],
		"all messages must be delivered exactly once")

	if strings.Join(received[:count], "") != strings.Join(sent, "") {
		t.Logf(
			"delivery was reordered (this is the documented behaviour)\n  sent:     %s\n  received: %s",
			strings.Join(sent, ""), strings.Join(received[:count], ""),
		)
	}
}

/*
 * Helpers.
 */

// requireEventuallyDelivered repeatedly performs a send until every client has received something.
func requireEventuallyDelivered(t *testing.T, send func(), clients ...*SocketClient) {
	t.Helper()

	for _, client := range clients {
		target := client

		requireEventually(t, func() bool {
			send()

			_, ok := target.NextDataWithin(200 * time.Millisecond)

			return ok
		}, "a subscriber of "+target.Namespace+" never received the broadcast")
	}
}

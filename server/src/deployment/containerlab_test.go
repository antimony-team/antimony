package deployment

import (
	"encoding"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * Decoding containerlab's inspect output.
 *
 * The rest of this package needs containerlab and Docker to exercise, but the translation from
 * "containerlab inspect --format json" into the shared InspectContainer type is pure, so it can be
 * covered directly. That translation is also the part that changed when NodeState's text
 * unmarshaller was moved in here, which is what these tests are really guarding.
 */

// clabInspectFixture is a realistic "containerlab inspect --all --format json" payload: two labs,
// a mix of states, and the "N/A" placeholders containerlab emits for a container that has no
// address. Node names arrive fully qualified as clab-<lab>-<node>.
const clabInspectFixture = `{
  "demo-lab": [
    {
      "container_id": "9f2a1c4e5b6d",
      "image": "ghcr.io/nokia/srlinux:latest",
      "ipv4_address": "172.20.20.3/24",
      "ipv6_address": "3fff:172:20:20::3/64",
      "lab_name": "demo-lab",
      "labPath": "/opt/antimony/run/demo-lab/topology.clab.yaml",
      "name": "clab-demo-lab-srl1",
      "container_name": "ignored-by-the-parser",
      "state": "running"
    },
    {
      "container_id": "",
      "image": "alpine:latest",
      "ipv4_address": "N/A",
      "ipv6_address": "N/A",
      "lab_name": "demo-lab",
      "labPath": "/opt/antimony/run/demo-lab/topology.clab.yaml",
      "name": "clab-demo-lab-host1",
      "state": "exited"
    }
  ],
  "other-lab": [
    {
      "container_id": "aa11bb22cc33",
      "image": "alpine:latest",
      "ipv4_address": "172.20.20.9/24",
      "ipv6_address": "N/A",
      "lab_name": "other-lab",
      "labPath": "/opt/antimony/run/other-lab/topology.clab.yaml",
      "name": "clab-other-lab-host1",
      "state": "restarting"
    }
  ]
}`

/*
 * parseDockerState
 */

func TestParseDockerState_MapsEveryKnownDockerStatus(t *testing.T) {
	cases := map[string]NodeState{
		"created":    NodeStates.Stopped,
		"exited":     NodeStates.Stopped,
		"dead":       NodeStates.Stopped,
		"paused":     NodeStates.Stopped,
		"restarting": NodeStates.Starting,
		"running":    NodeStates.Running,
		"removing":   NodeStates.Stopping,
	}

	// Every entry in the lookup table must be covered, so a new status added there without a test
	// shows up as a missing case rather than passing silently.
	require.Len(t, cases, len(dockerStates), "every dockerStates entry must be covered here")

	for status, expected := range cases {
		t.Run(status, func(t *testing.T) {
			assert.Equal(t, expected, parseDockerState(status))
		})
	}
}

func TestParseDockerState_IsCaseInsensitive(t *testing.T) {
	for _, status := range []string{"RUNNING", "Running", "rUnNiNg"} {
		t.Run(status, func(t *testing.T) {
			assert.Equal(t, NodeStates.Running, parseDockerState(status))
		})
	}
}

func TestParseDockerState_TrimsSurroundingWhitespace(t *testing.T) {
	for _, status := range []string{" running", "running ", "\trunning\n"} {
		t.Run(status, func(t *testing.T) {
			assert.Equal(t, NodeStates.Running, parseDockerState(status))
		})
	}
}

func TestParseDockerState_UsesOnlyTheFirstWord(t *testing.T) {
	// Docker sometimes decorates the status with detail. Only the leading word is the state.
	cases := map[string]NodeState{
		"running (healthy)":         NodeStates.Running,
		"exited (0) 2 minutes ago":  NodeStates.Stopped,
		"restarting (1) 5 secs ago": NodeStates.Starting,
	}

	for status, expected := range cases {
		t.Run(status, func(t *testing.T) {
			assert.Equal(t, expected, parseDockerState(status))
		})
	}
}

func TestParseDockerState_UnknownStatusIsTreatedAsStopped(t *testing.T) {
	// Failing closed matters: an unrecognised status must not make a dead node look alive.
	for _, status := range []string{"", "   ", "nonsense", "up", "Up 2 hours"} {
		t.Run(status, func(t *testing.T) {
			assert.Equal(t, NodeStates.Stopped, parseDockerState(status))
		})
	}
}

/*
 * clabInspectContainer conversion
 */

func TestToInspectContainer_CarriesEveryField(t *testing.T) {
	raw := clabInspectContainer{
		Name:          "clab-demo-lab-srl1",
		LabName:       "demo-lab",
		LabPath:       "/opt/antimony/run/demo-lab/topology.clab.yaml",
		Image:         "ghcr.io/nokia/srlinux:latest",
		State:         "running",
		ContainerId:   "9f2a1c4e5b6d",
		ContainerName: "clab-demo-lab-srl1",
		IPv4Address:   "172.20.20.3/24",
		IPv6Address:   "3fff:172:20:20::3/64",
	}

	converted := raw.toInspectContainer()

	assert.Equal(t, "clab-demo-lab-srl1", converted.Name, "the prefix is stripped later, by the converter")
	assert.Equal(t, "demo-lab", converted.LabName)
	assert.Equal(t, "/opt/antimony/run/demo-lab/topology.clab.yaml", converted.LabPath)
	assert.Equal(t, "ghcr.io/nokia/srlinux:latest", converted.Image)
	assert.Equal(t, NodeStates.Running, converted.State, "the status string becomes a NodeState")
	assert.Equal(t, "9f2a1c4e5b6d", converted.ContainerId)
	assert.Equal(t, "172.20.20.3/24", converted.IPv4Address)
	assert.Equal(t, "3fff:172:20:20::3/64", converted.IPv6Address)
}

func TestClabToInspectContainer_StripsThePrefixAndKeepsTheFullName(t *testing.T) {
	converted := clabToInspectContainer("demo-lab", []clabInspectContainer{{
		Name:        "clab-demo-lab-srl1",
		ContainerId: "9f2a1c4e5b6d",
		State:       "running",
	}})

	require.Len(t, converted, 1)

	// The node name is the topology's node name; the container name is what Docker calls it.
	assert.Equal(t, "srl1", converted[0].Name)
	assert.Equal(t, "clab-demo-lab-srl1", converted[0].ContainerName)
}

func TestClabToInspectContainer_OverwritesAnyContainerNameFromTheJson(t *testing.T) {
	// parseInspectContainer derives ContainerName from Name, so whatever containerlab put in the
	// container_name field is discarded. Worth pinning, since the DTO does decode that field.
	converted := clabToInspectContainer("demo-lab", []clabInspectContainer{{
		Name:          "clab-demo-lab-srl1",
		ContainerName: "something-else-entirely",
		State:         "running",
	}})

	require.Len(t, converted, 1)
	assert.Equal(t, "clab-demo-lab-srl1", converted[0].ContainerName)
}

func TestClabToInspectContainer_LeavesAnUnprefixedNameAlone(t *testing.T) {
	// An externally managed container is not named clab-<lab>-<node>, so there is nothing to trim.
	converted := clabToInspectContainer("demo-lab", []clabInspectContainer{{
		Name:  "my-external-container",
		State: "running",
	}})

	require.Len(t, converted, 1)
	assert.Equal(t, "my-external-container", converted[0].Name)
	assert.Equal(t, "my-external-container", converted[0].ContainerName)
}

func TestClabToInspectContainer_ClearsNotApplicableAddresses(t *testing.T) {
	converted := clabToInspectContainer("demo-lab", []clabInspectContainer{{
		Name:        "clab-demo-lab-host1",
		State:       "exited",
		IPv4Address: "N/A",
		IPv6Address: "N/A",
	}})

	require.Len(t, converted, 1)
	assert.Empty(t, converted[0].IPv4Address, `"N/A" must become an empty address`)
	assert.Empty(t, converted[0].IPv6Address)
}

func TestClabToInspectContainer_EmptyInputYieldsEmptyOutput(t *testing.T) {
	assert.Empty(t, clabToInspectContainer("demo-lab", nil))
	assert.Empty(t, clabToInspectContainer("demo-lab", []clabInspectContainer{}))
}

func TestConvertInspectOutput_AppliesEachLabsOwnPrefix(t *testing.T) {
	converted := convertInspectOutput(map[string][]clabInspectContainer{
		"demo-lab":  {{Name: "clab-demo-lab-srl1", State: "running"}},
		"other-lab": {{Name: "clab-other-lab-srl1", State: "running"}},
	})

	require.Len(t, converted, 2)
	require.Len(t, converted["demo-lab"], 1)
	require.Len(t, converted["other-lab"], 1)

	// Each lab's containers must be trimmed with that lab's prefix, not some shared one.
	assert.Equal(t, "srl1", converted["demo-lab"][0].Name)
	assert.Equal(t, "srl1", converted["other-lab"][0].Name)
}

func TestConvertInspectOutput_EmptyInputYieldsEmptyOutput(t *testing.T) {
	assert.Empty(t, convertInspectOutput(map[string][]clabInspectContainer{}))
	assert.Empty(t, convertInspectOutput(nil))
}

/*
 * The full decode path
 */

func TestClabInspectFixture_DecodesAndConverts(t *testing.T) {
	var raw map[string][]clabInspectContainer
	require.NoError(t, json.Unmarshal([]byte(clabInspectFixture), &raw),
		"the inspect payload must decode into the provider's own DTO")

	converted := convertInspectOutput(raw)
	require.Len(t, converted, 2)

	demo := converted["demo-lab"]
	require.Len(t, demo, 2)

	byName := make(map[string]InspectContainer, len(demo))
	for _, container := range demo {
		byName[container.Name] = container
	}

	srl := byName["srl1"]
	assert.Equal(t, NodeStates.Running, srl.State)
	assert.Equal(t, "9f2a1c4e5b6d", srl.ContainerId)
	assert.Equal(t, "clab-demo-lab-srl1", srl.ContainerName)
	assert.Equal(t, "172.20.20.3/24", srl.IPv4Address)
	assert.Equal(t, "demo-lab", srl.LabName)

	host := byName["host1"]
	assert.Equal(t, NodeStates.Stopped, host.State, `"exited" must become stopped`)
	assert.Empty(t, host.IPv4Address)
	assert.Empty(t, host.IPv6Address)

	other := converted["other-lab"]
	require.Len(t, other, 1)
	assert.Equal(t, "host1", other[0].Name)
	assert.Equal(t, NodeStates.Starting, other[0].State, `"restarting" must become starting`)
}

/*
 * The invariant the refactor exists to protect.
 */

// TestInspectContainer_RoundTripsThroughJson is the regression guard for the bug that motivated
// moving the Docker status parsing into this package.
//
// NodeState used to carry an UnmarshalText (so containerlab's status strings could be decoded
// straight into InspectContainer) with no matching marshaller. encoding/json therefore wrote the
// state as a number and then refused to read that number back — "JSON value must be string type" —
// so a Go client could not decode the API's own response using the transport types, and
// transport.LabOut could not decode a payload it had produced itself.
func TestInspectContainer_RoundTripsThroughJson(t *testing.T) {
	original := InspectContainer{
		Name:          "srl1",
		LabName:       "demo-lab",
		LabPath:       "/opt/antimony/run/demo-lab/topology.clab.yaml",
		Image:         "ghcr.io/nokia/srlinux:latest",
		State:         NodeStates.Running,
		ContainerId:   "9f2a1c4e5b6d",
		ContainerName: "clab-demo-lab-srl1",
		IPv4Address:   "172.20.20.3/24",
		IPv6Address:   "3fff:172:20:20::3/64",
	}

	encoded, err := json.Marshal(original)
	require.NoError(t, err)

	// The wire format is the numeric enum, which is what the frontend already consumes.
	assert.Contains(t, string(encoded), `"state":2`)

	var decoded InspectContainer
	require.NoError(t, json.Unmarshal(encoded, &decoded),
		"the type must be able to decode its own output")

	assert.Equal(t, original, decoded)
}

func TestNodeState_RoundTripsForEveryState(t *testing.T) {
	for _, state := range []NodeState{
		NodeStates.Stopped,
		NodeStates.Starting,
		NodeStates.Running,
		NodeStates.Stopping,
	} {
		encoded, err := json.Marshal(state)
		require.NoError(t, err)

		var decoded NodeState
		require.NoErrorf(t, json.Unmarshal(encoded, &decoded), "state %d must round-trip", state)

		assert.Equal(t, state, decoded)
	}
}

// TestNodeState_TextMarshallingIsSymmetric pins the specific shape that caused the bug: a text
// unmarshaller without a matching marshaller.
//
// Either both or neither is fine. Implementing only UnmarshalText is what made encoding/json write
// a number and then refuse to read it, and this catches that combination directly rather than only
// through its symptom.
func TestNodeState_TextMarshallingIsSymmetric(t *testing.T) {
	var state NodeState

	_, hasUnmarshaler := any(&state).(encoding.TextUnmarshaler)
	_, hasMarshaler := any(&state).(encoding.TextMarshaler)

	assert.Falsef(
		t, hasUnmarshaler && !hasMarshaler,
		"NodeState implements TextUnmarshaler without TextMarshaler, which breaks JSON round-tripping",
	)
}

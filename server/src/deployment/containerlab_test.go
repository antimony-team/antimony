package deployment

import (
	"antimonyBackend/utils"
	"bufio"
	"bytes"
	"context"
	"encoding"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/samber/lo"
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

/*
 * sendClabOutput
 */

func TestSendClabOutput_SendsEachNonEmptyLineWithoutAnsiCodes(t *testing.T) {
	logs := &logCollector{}
	output := "\x1b[32mfirst\x1b[0m\n\nsecond\n"

	sendClabOutput(&output, logs.log)

	assert.Equal(t, []string{"first", "second"}, logs.all())
}

func TestSendClabOutput_ToleratesMissingOutput(t *testing.T) {
	logs := &logCollector{}

	sendClabOutput(nil, logs.log)

	assert.Empty(t, logs.all())
}

/*
 * The containerlab CLI.
 *
 * The provider shells out to containerlab for everything lab-wide. A fake containerlab script on
 * PATH records its arguments and replays the output the test prepares.
 */

// fakeClab is a containerlab stand-in on PATH. Calls are recorded, and the next call prints stdout
// and stderr and exits with exitCode.
type fakeClab struct {
	dir string
}

const fakeClabScript = `#!/bin/sh
printf '%%s\n' "$*" >> '%[1]s/calls'
[ -f '%[1]s/stderr' ] && cat '%[1]s/stderr' >&2
[ -f '%[1]s/stdout' ] && cat '%[1]s/stdout'
exit "$(cat '%[1]s/exit' 2>/dev/null || echo 0)"
`

func newFakeClab(t *testing.T) *fakeClab {
	t.Helper()

	dir := t.TempDir()
	script := fmt.Sprintf(fakeClabScript, dir)
	//nolint:gosec // the fake has to be executable to stand in for containerlab
	require.NoError(t, os.WriteFile(filepath.Join(dir, "containerlab"), []byte(script), 0o755))

	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	return &fakeClab{dir: dir}
}

func (f *fakeClab) respond(t *testing.T, stdout, stderr string, exitCode int) {
	t.Helper()

	require.NoError(t, os.WriteFile(filepath.Join(f.dir, "stdout"), []byte(stdout), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(f.dir, "stderr"), []byte(stderr), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(f.dir, "exit"), []byte(strconv.Itoa(exitCode)), 0o600))
}

func (f *fakeClab) calls(t *testing.T) []string {
	t.Helper()

	content, err := os.ReadFile(filepath.Join(f.dir, "calls"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	require.NoError(t, err)

	return strings.Split(strings.TrimSpace(string(content)), "\n")
}

func TestContainerlabLifecycle_RunsTheMatchingContainerlabCommand(t *testing.T) {
	provider := &ContainerlabProvider{}
	cases := map[string]struct {
		run      func(topologyFile string) error
		expected string
	}{
		"deploy": {
			func(file string) error { return provider.Deploy(context.Background(), file, "demo", nil) },
			"deploy -t %s",
		},
		"redeploy": {
			func(file string) error { return provider.Redeploy(context.Background(), file, "demo", nil) },
			"redeploy -t %s",
		},
		"destroy": {
			func(file string) error { return provider.Destroy(context.Background(), file, "demo", nil) },
			"destroy -t %s",
		},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			clab := newFakeClab(t)
			topologyFile := "/run/demo/topology.clab.yaml"

			// The commands never call the log function when there is no output.
			require.NoError(t, c.run(topologyFile))

			assert.Equal(t, []string{fmt.Sprintf(c.expected, topologyFile)}, clab.calls(t))
		})
	}
}

func TestContainerlabDeploy_ForwardsTheCommandOutput(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, "\x1b[1m+---+\x1b[0m\n| summary |\n", "", 0)
	logs := &logCollector{}

	require.NoError(t, (&ContainerlabProvider{}).Deploy(context.Background(), "topology.clab.yaml", "demo", logs.log))

	assert.Equal(t, []string{"+---+", "| summary |"}, logs.all())
}

func TestContainerlabDeploy_ForwardsContainerlabsLogAsClabLines(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, "", "14:15:16 INFO Creating lab directory\n14:15:17 WARN Unable to load kernel module\n", 0)
	logs := &logCollector{}

	require.NoError(t, (&ContainerlabProvider{}).Deploy(context.Background(), "topology.clab.yaml", "demo", logs.log))

	lines := logs.all()
	require.Len(t, lines, 2)
	assert.Contains(t, lines[0], "INFO CLAB Creating lab directory")
	assert.Contains(t, lines[1], "WARNING CLAB Unable to load kernel module")
}

func TestContainerlabDeploy_ReportsAFailingCommand(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, "", "", 1)

	err := (&ContainerlabProvider{}).Deploy(context.Background(), "topology.clab.yaml", "demo", (&logCollector{}).log)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "containerlab deploy -t topology.clab.yaml")
}

func TestContainerlabInspectLabs_DecodesEveryLab(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, clabInspectFixture, "", 0)

	labs, err := (&ContainerlabProvider{}).InspectLabs(context.Background(), (&logCollector{}).log)

	require.NoError(t, err)
	assert.Equal(t, []string{"inspect --all --format json"}, clab.calls(t))
	require.Len(t, labs["demo-lab"], 2)
	require.Len(t, labs["other-lab"], 1)
	assert.Equal(t, "srl1", labs["demo-lab"][0].Name)
	assert.Equal(t, NodeStates.Starting, labs["other-lab"][0].State)
}

func TestContainerlabInspectLabs_ReturnsNoLabsForEmptyOutput(t *testing.T) {
	newFakeClab(t)

	labs, err := (&ContainerlabProvider{}).InspectLabs(context.Background(), (&logCollector{}).log)

	require.NoError(t, err)
	assert.Empty(t, labs)
}

func TestContainerlabInspectLabs_FailsForInvalidOutputAndFailingCommands(t *testing.T) {
	cases := map[string]struct {
		stdout   string
		exitCode int
	}{
		"invalid json":    {"not json", 0},
		"failing command": {"", 1},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			clab := newFakeClab(t)
			clab.respond(t, c.stdout, "", c.exitCode)

			_, err := (&ContainerlabProvider{}).InspectLabs(context.Background(), (&logCollector{}).log)

			assert.Error(t, err)
		})
	}
}

func TestContainerlabInspectLab_SelectsTheRequestedLab(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, clabInspectFixture, "", 0)

	containers, err := (&ContainerlabProvider{}).InspectLab(
		context.Background(), "/run/demo/topology.clab.yaml", "other-lab", (&logCollector{}).log,
	)

	require.NoError(t, err)
	assert.Equal(t, []string{"inspect -t /run/demo/topology.clab.yaml --format json"}, clab.calls(t))
	require.Len(t, containers, 1)
	assert.Equal(t, "host1", containers[0].Name)
}

func TestContainerlabInspectLab_ReportsAMissingLabAsNotRunning(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, clabInspectFixture, "", 0)

	_, err := (&ContainerlabProvider{}).InspectLab(context.Background(), "", "missing-lab", (&logCollector{}).log)

	assert.ErrorIs(t, err, utils.ErrLabNotRunning)
}

func TestContainerlabInspectLab_ReturnsNoNodesForEmptyOutput(t *testing.T) {
	newFakeClab(t)

	containers, err := (&ContainerlabProvider{}).InspectLab(context.Background(), "", "demo-lab", (&logCollector{}).log)

	require.NoError(t, err)
	assert.Empty(t, containers)
}

func TestContainerlabInspectNode_FindsTheNodeByItsShortName(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, clabInspectFixture, "", 0)

	node, err := (&ContainerlabProvider{}).InspectNode(
		context.Background(),
		"",
		"demo-lab",
		"host1",
		(&logCollector{}).log,
	)

	require.NoError(t, err)
	assert.Equal(t, "clab-demo-lab-host1", node.ContainerName)
	assert.Equal(t, NodeStates.Stopped, node.State)
}

func TestContainerlabInspectNode_ReportsAnUnknownNode(t *testing.T) {
	clab := newFakeClab(t)
	clab.respond(t, clabInspectFixture, "", 0)

	_, err := (&ContainerlabProvider{}).InspectNode(
		context.Background(),
		"",
		"demo-lab",
		"missing",
		(&logCollector{}).log,
	)

	assert.ErrorIs(t, err, utils.ErrNodeNotFound)
}

/*
 * The Docker API.
 *
 * Everything node-level goes straight to Docker. The fake implements the calls the provider makes;
 * any other call panics on the nil embedded client, which flags a provider change the fake does not
 * cover yet.
 */

type fakeDocker struct {
	client.APIClient

	mu sync.Mutex

	containers  []container.Summary
	inspects    map[string]container.InspectResponse
	listOptions container.ListOptions

	started, stopped, restarted []string
	stopOptions                 []container.StopOptions

	execCreateErr error
	execOptions   container.ExecOptions
	execOutput    []byte
	execConn      net.Conn
	execInspect   container.ExecInspect
	resizes       []container.ResizeOptions

	logs        string
	logsOptions container.LogsOptions

	events       chan events.Message
	eventErrs    chan error
	eventOptions events.ListOptions
}

func newFakeDocker() *fakeDocker {
	return &fakeDocker{
		inspects:  map[string]container.InspectResponse{},
		events:    make(chan events.Message),
		eventErrs: make(chan error, 1),
	}
}

// addNode registers a containerlab node container. Its IP is empty for a node without an address,
// and its pid 0 for a stopped node.
func (d *fakeDocker) addNode(lab, node, id, ip string, pid int) {
	d.containers = append(d.containers, container.Summary{
		ID:     id,
		Labels: map[string]string{"containerlab": lab, "clab-node-name": node},
	})

	networks := map[string]*network.EndpointSettings{}
	if ip != "" {
		networks["clab"] = &network.EndpointSettings{IPAddress: ip}
	}

	d.inspects[id] = container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			ID:    id + "-full",
			State: &container.State{Pid: pid, Running: pid != 0},
		},
		NetworkSettings: &container.NetworkSettings{Networks: networks},
	}
}

func (d *fakeDocker) ContainerList(_ context.Context, options container.ListOptions) ([]container.Summary, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.listOptions = options

	return lo.Filter(d.containers, func(c container.Summary, _ int) bool {
		for _, label := range options.Filters.Get("label") {
			key, value, _ := strings.Cut(label, "=")
			if c.Labels[key] != value {
				return false
			}
		}
		return true
	}), nil
}

func (d *fakeDocker) ContainerInspect(_ context.Context, id string) (container.InspectResponse, error) {
	inspect, ok := d.inspects[id]
	if !ok {
		return container.InspectResponse{}, fmt.Errorf("no such container: %s", id)
	}
	return inspect, nil
}

func (d *fakeDocker) ContainerStart(_ context.Context, id string, _ container.StartOptions) error {
	d.started = append(d.started, id)
	return nil
}

func (d *fakeDocker) ContainerStop(_ context.Context, id string, options container.StopOptions) error {
	d.stopped = append(d.stopped, id)
	d.stopOptions = append(d.stopOptions, options)
	return nil
}

func (d *fakeDocker) ContainerRestart(_ context.Context, id string, options container.StopOptions) error {
	d.restarted = append(d.restarted, id)
	d.stopOptions = append(d.stopOptions, options)
	return nil
}

func (d *fakeDocker) ContainerExecCreate(
	_ context.Context,
	_ string,
	options container.ExecOptions,
) (container.ExecCreateResponse, error) {
	d.execOptions = options
	if d.execCreateErr != nil {
		return container.ExecCreateResponse{}, d.execCreateErr
	}
	return container.ExecCreateResponse{ID: "exec-1"}, nil
}

func (d *fakeDocker) ContainerExecAttach(
	_ context.Context,
	_ string,
	_ container.ExecAttachOptions,
) (types.HijackedResponse, error) {
	if d.execConn != nil {
		return types.HijackedResponse{Conn: d.execConn, Reader: bufio.NewReader(d.execConn)}, nil
	}

	conn, _ := net.Pipe()
	return types.HijackedResponse{Conn: conn, Reader: bufio.NewReader(bytes.NewReader(d.execOutput))}, nil
}

func (d *fakeDocker) ContainerExecInspect(_ context.Context, _ string) (container.ExecInspect, error) {
	return d.execInspect, nil
}

func (d *fakeDocker) ContainerExecResize(_ context.Context, _ string, options container.ResizeOptions) error {
	d.resizes = append(d.resizes, options)
	return nil
}

func (d *fakeDocker) ContainerLogs(_ context.Context, _ string, options container.LogsOptions) (io.ReadCloser, error) {
	d.logsOptions = options
	return io.NopCloser(strings.NewReader(d.logs)), nil
}

func (d *fakeDocker) Events(_ context.Context, options events.ListOptions) (<-chan events.Message, <-chan error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.eventOptions = options

	return d.events, d.eventErrs
}

// multiplexed frames output the way Docker does for an exec without a TTY.
func multiplexed(t *testing.T, stdout, stderr string) []byte {
	t.Helper()

	var buffer bytes.Buffer
	_, err := stdcopy.NewStdWriter(&buffer, stdcopy.Stdout).Write([]byte(stdout))
	require.NoError(t, err)
	_, err = stdcopy.NewStdWriter(&buffer, stdcopy.Stderr).Write([]byte(stderr))
	require.NoError(t, err)

	return buffer.Bytes()
}

/*
 * containerForNode / resolveNode
 */

func TestContainerForNode_LooksUpTheNodeByItsContainerlabLabels(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 0)
	docker.addNode("demo", "host1", "c-host1", "", 0)
	docker.addNode("other", "srl1", "c-other", "", 0)
	provider := &ContainerlabProvider{client: docker}

	id, err := provider.containerForNode(context.Background(), "demo", "srl1")

	require.NoError(t, err)
	assert.Equal(t, "c-srl1", id)
	assert.True(t, docker.listOptions.All, "stopped nodes must be found too")
}

func TestContainerForNode_ReportsAnUnknownNode(t *testing.T) {
	provider := &ContainerlabProvider{client: newFakeDocker()}

	_, err := provider.containerForNode(context.Background(), "demo", "missing")

	assert.ErrorIs(t, err, utils.ErrNodeNotFound)
}

func TestResolveNode_ReturnsTheFullIdAndPid(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)

	target, err := (&ContainerlabProvider{client: docker}).resolveNode(context.Background(), "demo", "srl1")

	require.NoError(t, err)
	assert.Equal(t, dockerTarget{fullContainerId: "c-srl1-full", pid: 4242}, target)
}

func TestResolveNode_ReportsAStoppedNodeAsNotRunning(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 0)

	_, err := (&ContainerlabProvider{client: docker}).resolveNode(context.Background(), "demo", "srl1")

	assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
}

/*
 * Exec / ExecInteractive
 */

func TestContainerlabExec_ReturnsTheCombinedOutputAndExitCode(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)
	docker.execOutput = multiplexed(t, "out\n", "err\n")
	docker.execInspect = container.ExecInspect{ExitCode: 3}

	output, code, err := (&ContainerlabProvider{client: docker}).Exec(
		context.Background(), "demo", "srl1", []string{"ip", "link"},
	)

	require.NoError(t, err)
	assert.Equal(t, "out\nerr\n", output)
	assert.Equal(t, 3, code)
	assert.Equal(t, []string{"ip", "link"}, docker.execOptions.Cmd)
	assert.False(t, docker.execOptions.Tty)
}

func TestContainerlabExec_ReportsAStoppedNodeAsNotRunning(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 0)
	// Docker refuses an exec in a stopped container with a conflict.
	docker.execCreateErr = fmt.Errorf("container is not running: %w", cerrdefs.ErrConflict)

	_, _, err := (&ContainerlabProvider{client: docker}).Exec(context.Background(), "demo", "srl1", []string{"true"})

	assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
}

func TestContainerlabExecInteractive_ConnectsToTheRunningShell(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)
	local, remote := net.Pipe()
	docker.execConn = local
	docker.execInspect = container.ExecInspect{Running: true}

	session, err := (&ContainerlabProvider{client: docker}).ExecInteractive(
		context.Background(), "demo", "srl1", []string{"bash"},
	)
	require.NoError(t, err)
	defer session.Close()

	assert.True(t, docker.execOptions.Tty)
	assert.True(t, docker.execOptions.AttachStdin)

	go func() { _, _ = remote.Write([]byte("prompt$ ")) }()
	buffer := make([]byte, 8)
	_, err = io.ReadFull(session, buffer)
	require.NoError(t, err)
	assert.Equal(t, "prompt$ ", string(buffer))

	require.NoError(t, session.Resize(120, 40))
	assert.Equal(t, []container.ResizeOptions{{Width: 120, Height: 40}}, docker.resizes)
}

func TestContainerlabExecInteractive_FailsForACommandThatDoesNotStart(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)
	docker.execInspect = container.ExecInspect{Running: false, ExitCode: 127}

	_, err := (&ContainerlabProvider{client: docker}).ExecInteractive(
		context.Background(), "demo", "srl1", []string{"missing-shell"},
	)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exit code 127")
}

/*
 * DialNode
 */

func TestContainerlabDialNode_ConnectsToTheNodesAddress(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	go func() {
		conn, err := listener.Accept()
		if err == nil {
			_, _ = conn.Write([]byte("SSH-2.0"))
			_ = conn.Close()
		}
	}()

	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "127.0.0.1", 4242)
	port := listener.Addr().(*net.TCPAddr).Port

	conn, err := (&ContainerlabProvider{client: docker}).DialNode(context.Background(), "demo", "srl1", port)
	require.NoError(t, err)
	defer conn.Close()

	banner, err := io.ReadAll(conn)
	require.NoError(t, err)
	assert.Equal(t, "SSH-2.0", string(banner))
}

func TestContainerlabDialNode_ReportsANodeWithoutAddressAsNotRunning(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 0)

	_, err := (&ContainerlabProvider{client: docker}).DialNode(context.Background(), "demo", "srl1", 22)

	assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
}

/*
 * OpenCapture
 */

func TestContainerlabOpenCapture_FailsForAStoppedNode(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 0)

	_, err := (&ContainerlabProvider{client: docker}).OpenCapture(context.Background(), "demo", "srl1", "eth1")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestContainerlabOpenCapture_ReportsAnUnknownNode(t *testing.T) {
	_, err := (&ContainerlabProvider{client: newFakeDocker()}).OpenCapture(context.Background(), "demo", "x", "eth1")

	assert.ErrorIs(t, err, utils.ErrNodeNotFound)
}

/*
 * StartNode / StopNode / RestartNode
 */

func TestContainerlabNodeLifecycle_ActsOnTheNodesContainer(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)
	provider := &ContainerlabProvider{client: docker}

	require.NoError(t, provider.StartNode(context.Background(), "demo", "srl1"))
	require.NoError(t, provider.StopNode(context.Background(), "demo", "srl1"))
	require.NoError(t, provider.RestartNode(context.Background(), "demo", "srl1"))

	assert.Equal(t, []string{"c-srl1"}, docker.started)
	assert.Equal(t, []string{"c-srl1"}, docker.stopped)
	assert.Equal(t, []string{"c-srl1"}, docker.restarted)
}

func TestContainerlabNodeLifecycle_GivesTheNodeTenSecondsToStop(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)
	provider := &ContainerlabProvider{client: docker}

	require.NoError(t, provider.StopNode(context.Background(), "demo", "srl1"))
	require.NoError(t, provider.RestartNode(context.Background(), "demo", "srl1"))

	// Docker's timeout is in seconds, a time.Duration here would make it wait practically forever
	// for a node that ignores SIGTERM.
	require.Len(t, docker.stopOptions, 2)
	for _, options := range docker.stopOptions {
		require.NotNil(t, options.Timeout)
		assert.Equal(t, 10, *options.Timeout)
	}
}

func TestContainerlabNodeLifecycle_ReportsAnUnknownNode(t *testing.T) {
	provider := &ContainerlabProvider{client: newFakeDocker()}

	require.ErrorIs(t, provider.StartNode(context.Background(), "demo", "x"), utils.ErrNodeNotFound)
	require.ErrorIs(t, provider.StopNode(context.Background(), "demo", "x"), utils.ErrNodeNotFound)
	assert.ErrorIs(t, provider.RestartNode(context.Background(), "demo", "x"), utils.ErrNodeNotFound)
}

/*
 * RegisterListener
 */

func TestContainerlabRegisterListener_ReportsContainerlabNodesOnly(t *testing.T) {
	docker := newFakeDocker()
	updates := &logCollector{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error)

	go func() { done <- (&ContainerlabProvider{client: docker}).RegisterListener(ctx, updates.log) }()

	docker.events <- events.Message{Actor: events.Actor{Attributes: map[string]string{"clab-node-name": "srl1"}}}
	docker.events <- events.Message{Actor: events.Actor{Attributes: map[string]string{"name": "unrelated"}}}
	docker.events <- events.Message{Actor: events.Actor{Attributes: map[string]string{"clab-node-name": "host1"}}}
	cancel()

	require.ErrorIs(t, <-done, context.Canceled)
	assert.Equal(t, []string{"srl1", "host1"}, updates.all())

	docker.mu.Lock()
	defer docker.mu.Unlock()
	assert.Equal(t, []string{"container"}, docker.eventOptions.Filters.Get("type"))
	assert.ElementsMatch(t,
		[]string{"start", "stop", "die", "destroy", "create"},
		docker.eventOptions.Filters.Get("event"),
	)
}

func TestContainerlabRegisterListener_StopsOnAnEventStreamError(t *testing.T) {
	docker := newFakeDocker()
	docker.eventErrs <- errors.New("daemon went away")

	err := (&ContainerlabProvider{client: docker}).RegisterListener(context.Background(), func(string) {})

	assert.EqualError(t, err, "daemon went away")
}

/*
 * StreamContainerLogs
 */

func TestContainerlabStreamContainerLogs_FollowsTheContainerLog(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 4242)
	docker.logs = "2026-10-01T14:00:00Z booting\n2026-10-01T14:00:01Z ready\n"
	logs := &logCollector{}

	require.NoError(t, (&ContainerlabProvider{client: docker}).StreamContainerLogs(
		context.Background(), "demo", "srl1", logs.log,
	))

	assert.Eventually(t, func() bool { return len(logs.all()) == 2 }, time.Second, 10*time.Millisecond)
	assert.Equal(t, "2026-10-01T14:00:01Z ready", logs.all()[1])
	assert.True(t, docker.logsOptions.Follow)
	assert.True(t, docker.logsOptions.Timestamps)
	assert.True(t, docker.logsOptions.ShowStdout && docker.logsOptions.ShowStderr)
}

/*
 * GetNetworkInterfaces
 */

func TestContainerlabGetNetworkInterfaces_ReadsTheInterfacesOfTheNodesNetworkNamespace(t *testing.T) {
	if _, err := os.Stat("/proc/self/root/sys/class/net"); err != nil {
		t.Skip("needs a Linux /proc")
	}

	// The provider reads /proc/<pid>/root/sys/class/net, so this test's own pid stands in for a node
	// and the interfaces of the host it runs on are the expected result.
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", os.Getpid())

	interfaces, err := (&ContainerlabProvider{client: docker}).GetNetworkInterfaces(
		context.Background(),
		"demo",
		"srl1",
	)
	require.NoError(t, err)

	entries, err := os.ReadDir("/sys/class/net")
	require.NoError(t, err)
	expected := lo.FilterMap(entries, func(e os.DirEntry, _ int) (string, bool) { return e.Name(), e.Name() != "lo" })

	assert.ElementsMatch(t, expected, lo.Map(interfaces, func(i NodeInterface, _ int) string { return i.Name }))
	for _, i := range interfaces {
		assert.Positivef(t, i.MTU, "interface %s must report its MTU", i.Name)
		assert.NotEmptyf(t, i.State, "interface %s must report its state", i.Name)
	}
}

func TestContainerlabGetNetworkInterfaces_ReportsAStoppedNodeAsNotRunning(t *testing.T) {
	docker := newFakeDocker()
	docker.addNode("demo", "srl1", "c-srl1", "", 0)

	_, err := (&ContainerlabProvider{client: docker}).GetNetworkInterfaces(context.Background(), "demo", "srl1")

	assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
}

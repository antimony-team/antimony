//go:build e2e

package test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony/server/src/deployment"
	"github.com/antimony-team/antimony/server/src/domain/lab"
	"github.com/antimony-team/antimony/server/src/domain/statusmessage"
	"github.com/antimony-team/antimony/server/src/runtime/instance"
	"github.com/antimony-team/antimony/server/src/socket"
	"github.com/antimony-team/antimony/server/src/utils"
)

/*
 * Antimony on a real provider.
 *
 * The provider e2e tests in the deployment package check the providers on their own. These run the whole
 * server on one: the harness' services with containerlab or clabernetes instead of the dummy, driven through
 * the API, the socket commands and the SSH server like the interface does. They cover what the provider tests
 * can't: how the instance service and the SSH server use a provider. Deploying, node commands, shells and stats
 * are tested through the interface in interface/e2e/provider/.
 *
 * Run them with "task test-e2e-containerlab" or "task test-e2e-clabernetes". ANTIMONY_E2E_PROVIDER selects the
 * provider, containerlab needs root.
 */

const (
	e2eProviderEnv = "ANTIMONY_E2E_PROVIDER"
	e2eLogMarker   = "antimony-e2e-started"

	e2eHost1Address = "10.99.0.1"
	e2eHost2Address = "10.99.0.2"
)

const e2eTopologyDefinition = `name: e2e
topology:
  nodes:
    host1:
      kind: linux
      image: alpine:latest
      cmd: sh -c "echo ` + e2eLogMarker + `; exec sleep infinity"
    host2:
      kind: linux
      image: alpine:latest
      cmd: sh -c "echo ` + e2eLogMarker + `; exec sleep infinity"
  links:
    - endpoints: ["host1:eth1", "host2:eth1"]
`

// e2eEnv is a harness on a real provider.
type e2eEnv struct {
	*Harness

	providerName string

	// timeout bounds a deployment or a node operation, clabernetes has to schedule pods
	timeout time.Duration
}

func newE2EEnv(t *testing.T) *e2eEnv {
	t.Helper()

	env := &e2eEnv{providerName: os.Getenv(e2eProviderEnv)}

	var provider deployment.DeploymentProvider
	switch env.providerName {
	case "containerlab":
		if os.Geteuid() != 0 {
			t.Fatal("the containerlab e2e tests need root, run them with task test-e2e-containerlab")
		}
		provider = deployment.CreateContainerlabProvider()
		env.timeout = 2 * time.Minute
	case "clabernetes":
		provider = deployment.CreateClabernetesProvider()
		env.timeout = 5 * time.Minute
	default:
		t.Skipf("%s is %q, set it to containerlab or clabernetes", e2eProviderEnv, env.providerName)
	}

	env.Harness = NewHarness(t, WithRuntimeProvider(provider))

	return env
}

// createLab creates a lab of two linked alpine nodes through the API and returns its id. The lab is destroyed when
// the test ends.
func (e *e2eEnv) createLab(t *testing.T, name string) string {
	t.Helper()

	topologyRow := e.createTopology(
		utils.GenerateUuid(),
		strings.Replace(
			e2eTopologyDefinition,
			"name: e2e",
			"name: "+strings.ReplaceAll(strings.ToLower(name), " ", "-"),
			1,
		),
		"",
		e.Seed.PublicBoth,
		e.Seed.Admin,
	)

	start := time.Now().Add(-time.Minute)

	var labId string
	e.POST("/labs", lab.LabIn{
		Name:       ptr(name),
		StartTime:  &start,
		TopologyId: ptr(topologyRow.UUID),
	}, e.Seed.Admin.Token).RequireOk(&labId)

	created, err := e.LabRepo.GetByUuid(t.Context(), labId)
	require.NoError(t, err)
	instanceName := created.InstanceName
	topologyFile := e.Storage.GetRunTopologyDefinitionFile(labId)

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
		defer cancel()

		if err := e.Runtime.Destroy(ctx, topologyFile, instanceName, nil); err != nil {
			t.Logf("cleaning up lab %s failed: %v", instanceName, err)
		}
	})

	return labId
}

// deployLab deploys a lab through the instance service and waits until its nodes are ready.
func (e *e2eEnv) deployLab(t *testing.T, labId string) {
	t.Helper()

	e.DeployLab(labId)
	e.waitForLab(t, labId, func(c *assert.CollectT, nodes map[string]instance.InstanceNode) {
		for _, node := range nodes {
			assert.Truef(c, node.IsReady, "%s isn't ready", node.Name)
		}
	})
}

func (e *e2eEnv) instanceName(t *testing.T, labId string) string {
	t.Helper()

	labRow, err := e.LabRepo.GetByUuid(t.Context(), labId)
	require.NoError(t, err)

	return labRow.InstanceName
}

// nodes returns a copy of the lab's nodes as the instance service sees them.
func (e *e2eEnv) nodes(labId string) map[string]instance.InstanceNode {
	labInstance := e.InstanceService.GetInstance(labId)
	if labInstance == nil {
		return nil
	}

	labInstance.DataMutex.Lock()
	defer labInstance.DataMutex.Unlock()

	nodes := make(map[string]instance.InstanceNode, len(labInstance.Nodes))
	for name, node := range labInstance.Nodes {
		nodes[name] = *node
	}

	return nodes
}

func (e *e2eEnv) waitForLab(
	t *testing.T,
	labId string,
	check func(c *assert.CollectT, nodes map[string]instance.InstanceNode),
) {
	t.Helper()

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		nodes := e.nodes(labId)
		require.Len(c, nodes, 2)
		check(c, nodes)
	}, e.timeout, time.Second)
}

func (e *e2eEnv) waitForNodeState(t *testing.T, labId string, node string, state deployment.NodeState) {
	t.Helper()

	e.waitForLab(t, labId, func(c *assert.CollectT, nodes map[string]instance.InstanceNode) {
		assert.Equalf(c, state, nodes[node].State, "%s isn't in state %d", node, state)
	})
}

func (e *e2eEnv) mustExec(t *testing.T, labId string, node string, cmd ...string) {
	t.Helper()

	out, code, err := e.Runtime.Exec(t.Context(), e.instanceName(t, labId), node, cmd)
	require.NoError(t, err)
	require.Equalf(t, 0, code, "%v in %s failed: %s", cmd, node, out)
}

/*
 * Restoring
 */

func TestProviderE2E_RunningLabsAreRestoredOnStartup(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Restore")
	e.deployLab(t, labId)

	// A second instance service on the same database stands in for a restarted server
	sockets := socket.CreateManager(e.Auth)
	restarted := instance.CreateService(
		e.Config, e.SchemaService, e.LabRepo, e.TopologyService, e.Storage, sockets,
		utils.CreateEventBus[*lab.Lab](),
		socket.CreateOutputNamespace[statusmessage.Message](sockets, false, nil, false, nil, "status-messages"),
		e.Runtime,
	)
	t.Cleanup(restarted.Close)
	t.Cleanup(func() { sockets.Server().Close(nil) })

	restarted.Revive()

	restored := restarted.GetInstance(labId)
	require.NotNil(t, restored, "the running lab wasn't restored")

	restored.DataMutex.Lock()
	assert.Equal(t, instance.InstanceStates.Running, restored.State)
	assert.True(t, restored.Recovered)
	for _, node := range restored.Nodes {
		assert.Equal(t, deployment.NodeStates.Running, node.State, "node %s", node.Name)
		assert.NotEmpty(t, node.ContainerId, "node %s", node.Name)
	}
	restored.DataMutex.Unlock()

	// The restored nodes go through the startup listener again
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		restored.DataMutex.Lock()
		defer restored.DataMutex.Unlock()

		for _, node := range restored.Nodes {
			assert.Truef(c, node.IsReady, "%s isn't ready", node.Name)
		}
	}, e.timeout, time.Second)
}

/*
 * Nodes
 */

// A node that changes behind Antimony's back, like a "docker stop" on the host, shows up through the provider's
// events.
func TestProviderE2E_NodeChangesOutsideAntimonyAreNoticed(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Outside")
	e.deployLab(t, labId)
	instanceName := e.instanceName(t, labId)

	require.NoError(t, e.Runtime.StopNode(t.Context(), instanceName, "host2"))
	e.waitForNodeState(t, labId, "host2", deployment.NodeStates.Stopped)

	require.NoError(t, e.Runtime.StartNode(t.Context(), instanceName, "host2"))
	e.waitForNodeState(t, labId, "host2", deployment.NodeStates.Running)

	t.Run("a node whose container is removed", func(t *testing.T) {
		if e.providerName != "containerlab" {
			t.Skip("only containerlab nodes can lose their container, clabernetes recreates a missing pod")
		}

		containerName := e.nodes(labId)["host2"].ContainerName
		require.NotEmpty(t, containerName)

		//nolint:gosec // the container name comes from the test's own lab
		output, err := exec.CommandContext(t.Context(), "docker", "rm", "-f", containerName).CombinedOutput()
		require.NoError(t, err, string(output))

		e.waitForNodeState(t, labId, "host2", deployment.NodeStates.Stopped)
		// The other node isn't affected
		e.waitForNodeState(t, labId, "host1", deployment.NodeStates.Running)
	})
}

// Node names repeat across labs, so the provider's events have to reach the lab the node belongs to. Several labs
// and rounds make sure it doesn't depend on map order.
func TestProviderE2E_EventsReachTheRightLabWhenNodeNamesRepeat(t *testing.T) {
	const labCount = 3
	const rounds = 3

	e := newE2EEnv(t)

	labIds := make([]string, labCount)
	for i := range labIds {
		labIds[i] = e.createLab(t, fmt.Sprintf("E2E Same Names %d", i+1))
		e.deployLab(t, labIds[i])
	}

	target := labIds[labCount-1]
	instanceName := e.instanceName(t, target)

	// noticed reports whether the target lab sees host2 reach state while a node operation may take. Stopping a node
	// takes about half a minute on clabernetes.
	noticed := func(state deployment.NodeState) bool {
		deadline := time.Now().Add(e.timeout)
		for time.Now().Before(deadline) {
			if e.nodes(target)["host2"].State == state {
				return true
			}
			time.Sleep(500 * time.Millisecond)
		}
		return false
	}

	missed := 0
	for range rounds {
		require.NoError(t, e.Runtime.StopNode(t.Context(), instanceName, "host2"))
		if !noticed(deployment.NodeStates.Stopped) {
			missed++
		}

		require.NoError(t, e.Runtime.StartNode(t.Context(), instanceName, "host2"))
		if !noticed(deployment.NodeStates.Running) {
			missed++
		}
	}

	// The other labs' nodes keep running
	for _, labId := range labIds[:labCount-1] {
		assert.Equal(t, deployment.NodeStates.Running, e.nodes(labId)["host2"].State)
	}

	assert.Zero(t, missed, "the lab missed %d of %d changes of its node", missed, 2*rounds)
}

/*
 * Captures
 */

func TestProviderE2E_CapturesStreamTheNodesTraffic(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Capture")
	e.deployLab(t, labId)

	e.mustExec(t, labId, "host1", "ip", "addr", "add", e2eHost1Address+"/30", "dev", "eth1")
	e.mustExec(t, labId, "host2", "ip", "addr", "add", e2eHost2Address+"/30", "dev", "eth1")
	e.mustExec(t, labId, "host1", "ip", "link", "set", "eth1", "up")
	e.mustExec(t, labId, "host2", "ip", "link", "set", "eth1", "up")

	instanceName := e.instanceName(t, labId)
	server := startSSHServer(t, e.Harness)
	capture := startCaptureSession(t, server.dial(t, instanceName+"/host1"), "tcpdump -U -i eth1 -w -", nil)
	defer capture.client.Close()

	require.True(t, capture.waitForHeader(t, 30*time.Second), "the capture didn't start: %s", capture.stderr.String())

	pinger, cancelPing := context.WithCancel(t.Context())
	defer cancelPing()
	go func() {
		for pinger.Err() == nil {
			_, _, _ = e.Runtime.Exec(
				pinger,
				instanceName,
				"host2",
				[]string{"ping", "-c", "1", "-W", "1", e2eHost1Address},
			)
		}
	}()

	packets := make(chan []byte, 64)
	go func() {
		for {
			data, _, err := capture.reader.ReadPacketData()
			if err != nil {
				return
			}
			packets <- data
		}
	}()

	deadline := time.After(30 * time.Second)
	for {
		select {
		case data := <-packets:
			if isICMPBetween(data, e2eHost2Address, e2eHost1Address) {
				return
			}
		case <-deadline:
			t.Fatal("the capture didn't see the ping from host2")
		}
	}
}

func isICMPBetween(data []byte, source, destination string) bool {
	packet := gopacket.NewPacket(data, layers.LayerTypeEthernet, gopacket.NoCopy)

	ip, ok := packet.Layer(layers.LayerTypeIPv4).(*layers.IPv4)
	if !ok || packet.Layer(layers.LayerTypeICMPv4) == nil {
		return false
	}

	return ip.SrcIP.String() == source && ip.DstIP.String() == destination
}

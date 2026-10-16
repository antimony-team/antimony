//go:build e2e

package test

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony-server/deployment"
	"github.com/antimony-team/antimony-server/domain/lab"
	"github.com/antimony-team/antimony-server/domain/statusmessage"
	"github.com/antimony-team/antimony-server/runtime/instance"
	"github.com/antimony-team/antimony-server/socket"
	"github.com/antimony-team/antimony-server/utils"
)

/*
 * Antimony on a real provider.
 *
 * The provider e2e tests in the deployment package check the providers on their own. These run the whole
 * server on one: the harness' services with containerlab or clabernetes instead of the dummy, driven through
 * the API, the socket commands and the SSH server like the interface does. They cover what the provider tests
 * can't: how the instance service, the shell service and the SSH server use a provider.
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
 * Deploying and destroying
 */

func TestProviderE2E_DeployingALabRunsItsNodes(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Deploy")

	client := e.Dial("/cmd", e.Seed.Admin.Token)
	client.EmitWithin(e.timeout, deployCommand(labId)).RequireOk(nil)

	e.waitForLab(t, labId, func(c *assert.CollectT, nodes map[string]instance.InstanceNode) {
		for _, node := range nodes {
			assert.Truef(c, node.IsReady, "%s isn't ready", node.Name)
		}
	})

	var labOut labDTO
	e.GET("/labs/"+labId, e.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)
	assert.Equal(t, int(instance.InstanceStates.Running), labOut.Instance.State)
	assert.ElementsMatch(t, []string{"host1", "host2"}, nodeNames(labOut.Instance.Nodes))

	for _, node := range labOut.Instance.Nodes {
		assert.Equal(t, int(deployment.NodeStates.Running), node.State, "node %s", node.Name)
		assert.NotEmpty(t, node.ContainerId, "node %s", node.Name)
		assert.NotEmpty(t, node.ContainerName, "node %s", node.Name)
		assert.NotEmpty(t, node.IPv4, "node %s", node.Name)

		// The link's interface is listed, the excluded ones aren't
		names := interfaceNames(node.Interfaces)
		assert.Contains(t, names, "eth1", "node %s", node.Name)
		assert.NotContains(t, names, "lo", "node %s", node.Name)
	}

	t.Run("the lab log has the deployment's output", func(t *testing.T) {
		// The log namespace only exists once the lab has been deployed, so the deployment is in the backlog
		labLog := e.Dial("/logs/"+labId, e.Seed.Admin.Token)

		var lines []string
		decodeInto(t, labLog.NextBacklog(), &lines)

		assert.True(t, slices.ContainsFunc(lines, func(line string) bool {
			return strings.Contains(line, "Deployment of lab was successful")
		}), "the log has no success message: %v", lines)
		assert.Greater(t, len(lines), 2, "the log should carry the provider's output too")
	})

	t.Run("the node log has the node's output", func(t *testing.T) {
		nodeLog := e.Dial("/logs/"+labId+"/host1", e.Seed.Admin.Token)

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			value, ok := nodeLog.NextBacklogWithin(time.Second)
			require.True(c, ok, "the node log has no backlog")
			assert.Contains(c, fmt.Sprint(value), e2eLogMarker)
		}, 15*time.Second, 100*time.Millisecond)
	})

	t.Run("destroying the lab removes it", func(t *testing.T) {
		client.EmitWithin(e.timeout, destroyCommand(labId)).RequireOk(nil)

		labs, err := e.Runtime.InspectLabs(t.Context(), nil)
		require.NoError(t, err)
		assert.NotContains(t, labs, e.instanceName(t, labId))

		var labOut labDTO
		e.GET("/labs/"+labId, e.Seed.Admin.Token).RequireOk(&labOut)
		if labOut.Instance != nil {
			assert.NotEqual(t, int(instance.InstanceStates.Running), labOut.Instance.State)
		}
	})
}

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

func TestProviderE2E_NodeCommandsChangeTheNodes(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Nodes")
	e.deployLab(t, labId)

	client := e.Dial("/cmd", e.Seed.Admin.Token)

	t.Run("stopping a node", func(t *testing.T) {
		client.EmitWithin(e.timeout, nodeCommand(cmdStopNode, labId, "host2")).RequireOk(nil)
		e.waitForNodeState(t, labId, "host2", deployment.NodeStates.Stopped)

		host2 := e.nodes(labId)["host2"]
		assert.Empty(t, host2.ContainerId)
		assert.Empty(t, host2.IPv4)
	})

	t.Run("starting a node", func(t *testing.T) {
		client.EmitWithin(e.timeout, nodeCommand(cmdStartNode, labId, "host2")).RequireOk(nil)
		e.waitForLab(t, labId, func(c *assert.CollectT, nodes map[string]instance.InstanceNode) {
			assert.Equal(c, deployment.NodeStates.Running, nodes["host2"].State)
			assert.True(c, nodes["host2"].IsReady)
		})
	})

	t.Run("restarting a node", func(t *testing.T) {
		before := e.nodes(labId)["host1"].ContainerId

		client.EmitWithin(e.timeout, nodeCommand(cmdRestartNode, labId, "host1")).RequireOk(nil)
		e.waitForLab(t, labId, func(c *assert.CollectT, nodes map[string]instance.InstanceNode) {
			assert.Equal(c, deployment.NodeStates.Running, nodes["host1"].State)
			assert.True(c, nodes["host1"].IsReady)
		})

		// Clabernetes replaces the pod, containerlab keeps the container
		if e.providerName == "clabernetes" {
			assert.NotEqual(t, before, e.nodes(labId)["host1"].ContainerId)
		}
	})
}

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
 * Shells, captures and stats
 */

func TestProviderE2E_ShellsRunInTheNode(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Shell")
	e.deployLab(t, labId)

	client := e.Dial("/cmd", e.Seed.Admin.Token)
	shellId := openShell(t, client, labId, "host1")
	shell := e.Dial("/shell/"+shellId, e.Seed.Admin.Token)

	var output strings.Builder
	waitForOutput := func(text string) {
		t.Helper()

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			for {
				value, ok := shell.NextDataWithin(100 * time.Millisecond)
				if !ok {
					break
				}
				output.Write(SocketBytes(t, value))
			}
			assert.Contains(c, output.String(), text)
		}, 30*time.Second, 100*time.Millisecond)
	}

	// The marker is computed by the shell, so the echoed input doesn't match it
	shell.EmitRawWithoutAck("echo e2e-$((6*7))\n")
	waitForOutput("e2e-42")

	shell.EmitRawWithoutAck("hostname\n")
	waitForOutput("host1")

	shell.EmitRawWithoutAck("stty size\n")
	waitForOutput(fmt.Sprintf("%d %d", defaultShellRows, defaultShellCols))

	client.Emit(resizeShellCommand(shellId, 120, 50)).RequireOk(nil)
	shell.EmitRawWithoutAck("stty size\n")
	waitForOutput("50 120")

	client.Emit(closeShellCommand(labId, shellId)).RequireOk(nil)
	assert.True(t, shell.WaitForDisconnect(), "closing the shell must disconnect its subscribers")
}

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

func TestProviderE2E_TheMonitorPublishesNodeStats(t *testing.T) {
	e := newE2EEnv(t)
	labId := e.createLab(t, "E2E Stats")
	e.deployLab(t, labId)

	stats := e.Dial("/stats/"+e.nodes(labId)["host1"].ContainerId, e.Seed.Admin.Token)

	value, ok := stats.NextDataWithin(15 * time.Second)
	require.True(t, ok, "the monitor didn't publish stats for the node")

	var sample instance.NodeStats
	decodeInto(t, value, &sample)

	assert.Positive(t, sample.MemoryUsage)
	assert.Positive(t, sample.MemoryLimit)
	assert.False(t, sample.Timestamp.IsZero())
	assert.Contains(t, sample.Interfaces, "eth1")
}

func isICMPBetween(data []byte, source, destination string) bool {
	packet := gopacket.NewPacket(data, layers.LayerTypeEthernet, gopacket.NoCopy)

	ip, ok := packet.Layer(layers.LayerTypeIPv4).(*layers.IPv4)
	if !ok || packet.Layer(layers.LayerTypeICMPv4) == nil {
		return false
	}

	return ip.SrcIP.String() == source && ip.DstIP.String() == destination
}

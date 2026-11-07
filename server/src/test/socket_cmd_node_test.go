package test

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony/server/src/auth"
	"github.com/antimony-team/antimony/server/src/deployment"
	"github.com/antimony-team/antimony/server/src/runtime/instance"
	"github.com/antimony-team/antimony/server/src/utils"
)

// nodeCommands is the set of per-node runtime commands, used for the checks that apply to all three.
var nodeCommands = map[string]int{
	"startNode":   cmdStartNode,
	"stopNode":    cmdStopNode,
	"restartNode": cmdRestartNode,
}

// nodeState reads a node's current state out of the running instance.
func nodeState(t *testing.T, h *Harness, labId string, nodeName string) deployment.NodeState {
	t.Helper()

	labInstance := h.InstanceService.GetInstance(labId)
	require.NotNil(t, labInstance)

	labInstance.DataMutex.Lock()
	defer labInstance.DataMutex.Unlock()

	for _, node := range labInstance.Nodes {
		if node.Name == nodeName {
			return node.State
		}
	}

	t.Fatalf("node %q not found in instance %q", nodeName, labId)

	return deployment.NodeStates.Stopped
}

// waitForNodeState polls until a node reaches the expected state.
func waitForNodeState(t *testing.T, h *Harness, labId, nodeName string, want deployment.NodeState) {
	t.Helper()

	requireEventually(t, func() bool {
		return nodeState(t, h, labId, nodeName) == want
	}, "node "+nodeName+" never reached the expected state")
}

/*
 * Validation shared by every node command.
 */

func TestNodeCommand_NonRunningLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			errorResponse := client.Emit(nodeCommand(command, LabAdminID, NodeHost)).RequireError(5012)

			assert.Contains(t, errorResponse.Message, "lab is not running")
		})
	}
}

func TestNodeCommand_UnknownLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			client.Emit(nodeCommand(command, "no-such-lab", NodeHost)).RequireError(5011)
		})
	}
}

func TestNodeCommand_MissingNodeFieldIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			// handleNodeCommand checks for a nil node before any validation runs, so a missing
			// node field is an invalid request (5422) rather than a missing node (5021).
			errorResponse := client.Emit(map[string]any{
				"labId":   LabAdminID,
				"command": command,
			}).RequireError(5422)

			assert.Contains(t, errorResponse.Message, "socket request was invalid")
		})
	}
}

func TestNodeCommand_UnknownNodeIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			client.Emit(nodeCommand(command, LabAdminID, "no-such-node")).RequireError(5021)
		})
	}
}

func TestNodeCommand_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Member.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			// Node commands use ErrNoDestroyAccessToLab, which unlike ErrNoDeployAccessToLab is in
			// the 5403 group.
			errorResponse := client.Emit(nodeCommand(command, LabAdminID, NodeHost)).RequireError(5403)

			assert.Contains(t, errorResponse.Message, "destroy access to the provided lab is not granted")
		})
	}
}

func TestNodeCommand_AdminCanControlSomeoneElsesNodes(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabMemberID)

	client := h.Dial("/cmd", h.Seed.AdminBare.Token)

	client.Emit(nodeCommand(cmdRestartNode, LabMemberID, NodeHost)).RequireOk(nil)

	assert.Equal(t, 1, h.Provider.CallCount("RestartNode"))
	waitForNodeState(t, h, LabMemberID, NodeHost, deployment.NodeStates.Running)
}

// unsupportedLifecycleTopology has one node of every sort that can't be started, stopped or restarted, and a
// router that can, including settings the nodes inherit from their group or the defaults.
const unsupportedLifecycleTopology = `name: lifecycle
topology:
  kinds:
    frr:
      auto-remove: true
  groups:
    shared:
      network-mode: host
  nodes:
    router: {kind: nokia_srlinux, image: ghcr.io/nokia/srlinux}
    bridge: {kind: bridge}
    hostnet: {kind: linux, image: alpine:latest, network-mode: host}
    grouped: {kind: linux, image: alpine:latest, group: shared}
    sidecar: {kind: linux, image: alpine:latest, network-mode: "container:router"}
    removed: {kind: linux, image: alpine:latest, auto-remove: true}
    inherited: {kind: frr, image: quay.io/frrouting/frr:10.2.1}
`

// deployLabOf creates a lab of a new topology with the given definition and deploys it.
func deployLabOf(t *testing.T, h *Harness, definition string) string {
	t.Helper()

	var labId string
	createLabOf(h, createTopology(t, h, definition), "Lifecycle", h.Seed.Admin.Token).RequireOk(&labId)
	h.DeployLab(labId)

	return labId
}

func TestNodeCommand_NodesWhoseLifecycleIsUnsupportedAreRejected(t *testing.T) {
	h := NewHarness(t)
	labId := deployLabOf(t, h, unsupportedLifecycleTopology)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			errorResponse := client.Emit(nodeCommand(command, labId, "hostnet")).RequireError(5023)

			assert.Contains(t, errorResponse.Message, "node 'hostnet' can't be started, stopped or restarted")
		})
	}

	assert.Zero(t, h.Provider.CallCount("StartNode")+h.Provider.CallCount("StopNode")+
		h.Provider.CallCount("RestartNode"))
}

func TestNodeCommand_OnlyNodesWithASupportedLifecycleCanBeRestarted(t *testing.T) {
	h := NewHarness(t)
	labId := deployLabOf(t, h, unsupportedLifecycleTopology)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for _, node := range []string{"bridge", "hostnet", "grouped", "sidecar", "removed", "inherited"} {
		t.Run(node, func(t *testing.T) {
			client.Emit(nodeCommand(cmdRestartNode, labId, node)).RequireError(5023)
		})
	}

	client.Emit(nodeCommand(cmdRestartNode, labId, "router")).RequireOk(nil)
	assert.Equal(t, 1, h.Provider.CallCount("RestartNode"))
}

func TestNodeCommand_NodesOfEveryKindCanBeRestarted(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeSRL)).RequireOk(nil)
	waitForNodeState(t, h, LabAdminID, NodeSRL, deployment.NodeStates.Running)
}

/*
 * stopNode
 */

func TestStopNodeCommand_StopsARunningNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)
	require.Equal(t, deployment.NodeStates.Running, nodeState(t, h, LabAdminID, NodeHost))

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)

	call := h.Provider.LastCall("StopNode")
	require.NotNil(t, call)
	assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
	assert.Equal(t, NodeHost, call.Args["nodeName"])

	assert.Equal(t, deployment.NodeStates.Stopped, nodeState(t, h, LabAdminID, NodeHost))
}

func TestStopNodeCommand_ClearsTheContainerIdentity(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)

	stopped := findHostNode(t, labOut.Instance.Nodes)

	assert.Empty(t, stopped.ContainerId, "a stopped node reports no container")
	assert.Empty(t, stopped.IPv4)
	assert.Empty(t, stopped.IPv6)
	assert.False(t, stopped.IsReady)
	assert.Empty(t, stopped.Interfaces)
}

func TestStopNodeCommand_AlreadyStoppedNodeIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)

	errorResponse := client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireError(5023)
	assert.Contains(t, errorResponse.Message, "node is already stopped")

	assert.Equal(t, 1, h.Provider.CallCount("StopNode"), "the provider must not be called again")
}

func TestStopNodeCommand_EmitsLabUpdates(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)

	// Stopping emits one update before the provider call and one after it.
	for _, update := range CollectPayloads[instanceUpdatePayload](updates, 2) {
		require.NotNil(t, update.LabId)
		assert.Equal(t, LabAdminID, *update.LabId)
	}
}

func TestStopNodeCommand_ProviderFailureIsReported(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	h.Provider.StopNodeFn = func(string, string) error { return deployment.ErrDummyProvider }

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// The dummy's error is not one of the mapped sentinels, so it arrives as the generic 5000.
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireError(5000)
}

/*
 * startNode
 */

func TestStartNodeCommand_StartsAStoppedNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)
	require.Equal(t, deployment.NodeStates.Stopped, nodeState(t, h, LabAdminID, NodeHost))

	client.Emit(nodeCommand(cmdStartNode, LabAdminID, NodeHost)).RequireOk(nil)

	call := h.Provider.LastCall("StartNode")
	require.NotNil(t, call)
	assert.Equal(t, NodeHost, call.Args["nodeName"])

	assert.Equal(t, deployment.NodeStates.Running, nodeState(t, h, LabAdminID, NodeHost))
}

func TestStartNodeCommand_AlreadyRunningNodeIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(nodeCommand(cmdStartNode, LabAdminID, NodeHost)).RequireError(5023)
	assert.Contains(t, errorResponse.Message, "node is already running")

	assert.False(t, h.Provider.WasCalled("StartNode"))
}

func TestStartNodeCommand_RunsTheStartupListener(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)

	h.Provider.ResetCalls()

	client.Emit(nodeCommand(cmdStartNode, LabAdminID, NodeHost)).RequireOk(nil)

	// The listener probes for SSH and then fetches the node's interfaces.
	requireEventually(t, func() bool {
		return h.Provider.WasCalled("GetNetworkInterfaces")
	}, "the startup listener must fetch the node interfaces once it is up")

	requireEventually(t, func() bool {
		var labOut labDTO
		h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

		if labOut.Instance == nil {
			return false
		}

		return findHostNode(t, labOut.Instance.Nodes).IsReady
	}, "the node must end up marked ready")
}

/*
 * restartNode
 */

func TestRestartNodeCommand_RestartsARunningNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeHost)).RequireOk(nil)

	call := h.Provider.LastCall("RestartNode")
	require.NotNil(t, call)
	assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
	assert.Equal(t, NodeHost, call.Args["nodeName"])

	waitForNodeState(t, h, LabAdminID, NodeHost, deployment.NodeStates.Running)
}

func TestRestartNodeCommand_RestartsAStoppedNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)

	// Restart is allowed from the stopped state; only Starting and Stopping are refused.
	client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeHost)).RequireOk(nil)

	waitForNodeState(t, h, LabAdminID, NodeHost, deployment.NodeStates.Running)
}

func TestRestartNodeCommand_ProviderFailureIsReported(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	h.Provider.RestartNodeFn = func(string, string) error { return deployment.ErrDummyProvider }

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeHost)).RequireError(5000)
}

/*
 * Concurrency.
 */

func TestNodeCommand_ConcurrentOperationIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// Hold the provider inside RestartNode so the instance's operation mutex stays taken.
	release := make(chan struct{})
	entered := make(chan struct{})

	h.Provider.RestartNodeFn = func(string, string) error {
		close(entered)
		<-release

		return nil
	}

	first := h.Dial("/cmd", h.Seed.Admin.Token)
	second := h.Dial("/cmd", h.Seed.Admin.Token)

	// TryEmit rather than Emit: this runs off the test goroutine, where t.Fatalf is not allowed.
	firstDone := make(chan bool, 1)

	go func() {
		_, ok := first.TryEmit(nodeCommand(cmdRestartNode, LabAdminID, NodeHost))
		firstDone <- ok
	}()

	select {
	case <-entered:
	case <-time.After(socketTimeout):
		t.Fatal("the first restart never reached the provider")
	}

	// A second command while the first still holds the mutex must fail fast rather than queue.
	errorResponse := second.Emit(nodeCommand(cmdStopNode, LabAdminID, NodeSRL)).RequireError(5013)
	assert.Contains(t, errorResponse.Message, "lab is busy")

	// Let the first command finish and make sure it did, so the goroutine cannot outlive the test.
	close(release)
	assert.True(t, <-firstDone, "the first restart must complete once the provider is released")
}

func TestNodeCommand_OperationsSucceedAgainOnceTheLabIsFree(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// Sequential commands on the same instance must all be accepted.
	for range 3 {
		client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeHost)).RequireOk(nil)
	}

	assert.Equal(t, 3, h.Provider.CallCount("RestartNode"))
}

/*
 * The SSH startup probe.
 */

func TestStartupProbe_TreatsEveryReadySignalAsStarted(t *testing.T) {
	cases := map[string]struct {
		output string
		code   int
	}{
		"ssh accepted the connection":  {"", 0},
		"no ssh client on the node":    {"sh: ssh: not found", 127},
		"ssh client is not executable": {"permission denied", 126},
		"server rejected credentials":  {"admin@localhost: Permission denied (publickey).", 255},
		"host key verification":        {"Host key verification failed.", 255},
		"too many auth failures":       {"Too many authentication failures", 255},
	}

	for name, probe := range cases {
		t.Run(name, func(t *testing.T) {
			h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
				p.ExecFn = func(string, string, []string) (string, int, error) {
					return probe.output, probe.code, nil
				}
			}))

			h.DeployLab(LabAdminID)

			requireEventually(t, func() bool {
				var labOut labDTO
				h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

				if labOut.Instance == nil {
					return false
				}

				return findHostNode(t, labOut.Instance.Nodes).IsReady
			}, "the node must be treated as started")
		})
	}
}

func TestStartupProbe_KeepsWaitingWhileNothingIsListening(t *testing.T) {
	// Exit 255 with no server marker means "nothing listening yet", so the probe retries rather
	// than giving up. The node must therefore not be marked ready.
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			return "ssh: connect to host localhost port 22: Connection refused", 255, nil
		}
	}))

	h.DeployLab(LabAdminID)

	// Long enough for at least one retry cycle (the probe sleeps two seconds between attempts).
	time.Sleep(500 * time.Millisecond)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)

	assert.False(t, findHostNode(t, labOut.Instance.Nodes).IsReady,
		"a node with nothing listening must stay not-ready while the probe retries")
	assert.Equal(t, int(deployment.NodeStates.Running), findHostNode(t, labOut.Instance.Nodes).State,
		"but it is still reported as running")
}

func TestStartupProbe_ProbeErrorMarksTheNodeStopped(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			return "", 0, deployment.ErrDummyProvider
		}
	}))

	h.DeployLab(LabAdminID)

	// waitForNodeStarted returns the error, and the listener then reports the node as stopped.
	waitForNodeState(t, h, LabAdminID, NodeHost, deployment.NodeStates.Stopped)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)

	assert.False(t, findHostNode(t, labOut.Instance.Nodes).IsReady)
}

func TestStartupProbe_UnexpectedExitCodeMarksTheNodeStopped(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			// Anything outside the handled set is treated as a hard failure.
			return "something unexpected", 42, nil
		}
	}))

	h.DeployLab(LabAdminID)

	waitForNodeState(t, h, LabAdminID, NodeHost, deployment.NodeStates.Stopped)
}

func TestStartupProbe_RetriesWhileTheNodeIsNotRunningYet(t *testing.T) {
	// The probe runs on the startup listener's goroutine, so the counter has to be atomic.
	var attempts atomic.Int64

	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			// The first probe reports the container as not running, which is a retry condition
			// rather than a failure.
			if attempts.Add(1) == 1 {
				return "", 0, utils.ErrNodeNotRunning
			}

			return "", 0, nil
		}
	}))

	h.DeployLab(LabAdminID)

	requireEventually(t, func() bool {
		var labOut labDTO
		h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

		if labOut.Instance == nil {
			return false
		}

		return findHostNode(t, labOut.Instance.Nodes).IsReady
	}, "the node must become ready after the retry")

	assert.GreaterOrEqual(t, attempts.Load(), int64(2), "the probe must have retried")
}

func TestStartupProbe_RunsInTheSshNamespaceOfTheKind(t *testing.T) {
	h := NewHarness(t, WithKindsConfig("linux:\n  sshNamespace: vrf-default\n"))

	h.DeployLab(LabAdminID)

	probes := func(nodeName string) [][]string {
		var probes [][]string
		for _, call := range h.Provider.Calls() {
			if call.Method == "Exec" && call.Args["nodeName"] == nodeName {
				probes = append(probes, call.Args["cmd"].([]string))
			}
		}
		return probes
	}

	requireEventually(t, func() bool {
		return len(probes(NodeHost)) > 0 && len(probes(NodeSRL)) > 0
	}, "both nodes must be probed")

	assert.Equal(t, []string{"ip", "netns", "exec", "vrf-default", "ssh"}, probes(NodeHost)[0][:5],
		"the probe of the configured kind must run in its namespace")
	assert.Equal(t, "ssh", probes(NodeSRL)[0][0], "other kinds must be probed in their own namespace")
}

func TestStartupProbe_ExcludedInterfacesAreFilteredOut(t *testing.T) {
	h := NewHarness(t, WithExcludedInterfaces("eth1", "lo"))

	h.DeployLab(LabAdminID)

	requireEventually(t, func() bool {
		var labOut labDTO
		h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

		if labOut.Instance == nil {
			return false
		}

		return findHostNode(t, labOut.Instance.Nodes).IsReady
	}, "the node must become ready")

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	host := findHostNode(t, labOut.Instance.Nodes)
	assert.Equal(t, []string{"eth0"}, interfaceNames(host.Interfaces),
		"both excluded patterns must be dropped")
}

func TestStartupProbe_InterfaceFailureLeavesTheNodeReadyWithNoInterfaces(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.InterfacesFn = func(string, string) ([]deployment.NodeInterface, error) {
			return nil, deployment.ErrDummyProvider
		}
	}))

	h.DeployLab(LabAdminID)

	// A node whose interfaces cannot be read is still considered ready; the interface list is just
	// left empty rather than blocking the startup.
	requireEventually(t, func() bool {
		var labOut labDTO
		h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

		if labOut.Instance == nil {
			return false
		}

		return findHostNode(t, labOut.Instance.Nodes).IsReady
	}, "the node must still become ready")

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	assert.Empty(t, findHostNode(t, labOut.Instance.Nodes).Interfaces)
}

/*
 * GetInstanceNode, the node lookup behind shells and the SSH server. A node is addressed by its container ID, by lab
 * ID or instance name plus node name, or by collection, lab and node name.
 */

// nodeAddress holds the optional arguments of GetInstanceNode, so each test only names the ones it uses.
type nodeAddress struct {
	labId, instanceName, collectionName, labName, nodeName, containerId *string
}

func getInstanceNode(
	h *Harness,
	address nodeAddress,
	authUser *auth.AuthenticatedUser,
) (instance.InstanceNode, string, error) {
	return h.InstanceService.GetInstanceNode(
		h.T.Context(),
		address.labId, address.instanceName, address.collectionName, address.labName, address.nodeName,
		address.containerId,
		authUser,
	)
}

func TestGetInstanceNode_FindsTheNodeByEveryAddress(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)

	containerId := h.Provider.Node(InstanceAdminLab, NodeHost).ContainerId

	cases := map[string]nodeAddress{
		"container id":      {containerId: &containerId},
		"lab id and node":   {labId: ptr(LabAdminID), nodeName: ptr(NodeHost)},
		"instance and node": {instanceName: ptr(InstanceAdminLab), nodeName: ptr(NodeHost)},
		"collection and node": {
			collectionName: ptr(CollectionPublicBoth),
			labName:        ptr("Admin Lab"),
			nodeName:       ptr(NodeHost),
		},
	}

	for name, address := range cases {
		t.Run(name, func(t *testing.T) {
			node, instanceName, err := getInstanceNode(h, address, nil)

			require.NoError(t, err)
			assert.Equal(t, NodeHost, node.Name)
			assert.Equal(t, InstanceAdminLab, instanceName)
			assert.Equal(t, nodeState(t, h, LabAdminID, NodeHost), node.State)
		})
	}
}

func TestGetInstanceNode_ReturnsACopy(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)

	node, _, err := getInstanceNode(h, nodeAddress{labId: ptr(LabAdminID), nodeName: ptr(NodeHost)}, nil)
	require.NoError(t, err)

	node.State = deployment.NodeStates.Stopping
	node.Interfaces = append(node.Interfaces, deployment.NodeInterface{Name: "injected"})

	again, _, err := getInstanceNode(h, nodeAddress{labId: ptr(LabAdminID), nodeName: ptr(NodeHost)}, nil)
	require.NoError(t, err)
	assert.NotEqual(t, deployment.NodeStates.Stopping, again.State, "changing the copy must not change the node")
	assert.NotContains(t, again.Interfaces, deployment.NodeInterface{Name: "injected"})
}

func TestGetInstanceNode_ReportsALabThatIsNotDeployed(t *testing.T) {
	h := NewHarness(t)

	cases := map[string]nodeAddress{
		"lab id and node":   {labId: ptr(LabAdminID), nodeName: ptr(NodeHost)},
		"instance and node": {instanceName: ptr(InstanceAdminLab), nodeName: ptr(NodeHost)},
		"collection and node": {
			collectionName: ptr(CollectionPublicBoth),
			labName:        ptr("Admin Lab"),
			nodeName:       ptr(NodeHost),
		},
	}

	for name, address := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := getInstanceNode(h, address, nil)

			assert.ErrorIs(t, err, utils.ErrLabNotRunning)
		})
	}
}

func TestGetInstanceNode_ReportsUnknownNodesAndLabs(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)

	cases := map[string]struct {
		address  nodeAddress
		expected error
	}{
		"unknown container id": {nodeAddress{containerId: ptr("no-such-container")}, utils.ErrNodeNotFound},
		// Stopped nodes have no container ID, so an empty one must not match them.
		"empty container id": {nodeAddress{containerId: ptr("")}, utils.ErrNodeNotFound},
		"unknown node":       {nodeAddress{labId: ptr(LabAdminID), nodeName: ptr("missing")}, utils.ErrNodeNotFound},
		"unknown lab id":     {nodeAddress{labId: ptr("no-such-lab"), nodeName: ptr(NodeHost)}, utils.ErrLabNotFound},
		"unknown lab name": {
			nodeAddress{
				collectionName: ptr(CollectionPublicBoth),
				labName:        ptr("Missing Lab"),
				nodeName:       ptr(NodeHost),
			},
			utils.ErrLabNotFound,
		},
		"lab in another collection": {
			nodeAddress{collectionName: ptr(CollectionHidden), labName: ptr("Admin Lab"), nodeName: ptr(NodeHost)},
			utils.ErrLabNotFound,
		},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := getInstanceNode(h, c.address, nil)

			assert.ErrorIs(t, err, c.expected)
		})
	}
}

func TestGetInstanceNode_RejectsAnIncompleteAddress(t *testing.T) {
	h := NewHarness(t)

	_, _, err := getInstanceNode(h, nodeAddress{labId: ptr(LabAdminID)}, nil)

	assert.ErrorIs(t, err, utils.ErrInvalidSocketRequest)
}

func TestGetInstanceNode_ChecksAccessToTheLabsCollection(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)

	address := nodeAddress{labId: ptr(LabAdminID), nodeName: ptr(NodeHost)}

	// The member belongs to PublicBoth, the outsider to no collection at all.
	_, _, err := getInstanceNode(h, address, &h.Seed.Member.Auth)
	require.NoError(t, err)

	_, _, err = getInstanceNode(h, address, &h.Seed.Outsider.Auth)
	require.ErrorIs(t, err, utils.ErrNoAccessToLab)

	// Without a user, as for the SSH server while it has no authentication, nothing is checked.
	_, _, err = getInstanceNode(h, address, nil)
	assert.NoError(t, err)
}

func TestGetInstanceNode_DoesNotRevealWhetherALabRunsToUsersWithoutAccess(t *testing.T) {
	h := NewHarness(t)

	// The admin lab is not deployed, but an outsider must learn that it has no access, not that the lab is down.
	_, _, err := getInstanceNode(h, nodeAddress{labId: ptr(LabAdminID), nodeName: ptr(NodeHost)}, &h.Seed.Outsider.Auth)

	assert.ErrorIs(t, err, utils.ErrNoAccessToLab)
}

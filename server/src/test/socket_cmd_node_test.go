package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/utils"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestNodeCommand_NonRestartableKindIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	for name, command := range nodeCommands {
		t.Run(name, func(t *testing.T) {
			// NodeSRL is of kind nokia_srlinux, which the kinds config leaves at canRestart=false.
			errorResponse := client.Emit(nodeCommand(command, LabAdminID, NodeSRL)).RequireError(5023)

			assert.Contains(t, errorResponse.Message, "unable to manually start nodes of kind")
			assert.Contains(t, errorResponse.Message, "nokia_srlinux")
		})
	}
}

func TestNodeCommand_KindsConfigDrivesTheRestartPolicy(t *testing.T) {
	// Flipping the policy in the config file must flip the guard, which is what makes the
	// kindsConfig path worth having.
	h := NewHarness(t, WithKindsConfig("nokia_srlinux:\n  canRestart: true\n"))

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeSRL)).RequireOk(nil)
	waitForNodeState(t, h, LabAdminID, NodeSRL, deployment.NodeStates.Running)

	// And the linux node, absent from this config, now falls back to the default of false.
	client.Emit(nodeCommand(cmdRestartNode, LabAdminID, NodeHost)).RequireError(5023)
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

	stopped := findNode(t, labOut.Instance.Nodes, NodeHost)

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

	h.Provider.StopNodeFn = func(string, string) error { return errFakeProvider }

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// The fake's error is not one of the mapped sentinels, so it arrives as the generic 5000.
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

		return findNode(t, labOut.Instance.Nodes, NodeHost).IsReady
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

	h.Provider.RestartNodeFn = func(string, string) error { return errFakeProvider }

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
			h := NewHarness(t, WithProvider(func(p *FakeProvider) {
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

				return findNode(t, labOut.Instance.Nodes, NodeHost).IsReady
			}, "the node must be treated as started")
		})
	}
}

func TestStartupProbe_KeepsWaitingWhileNothingIsListening(t *testing.T) {
	// Exit 255 with no server marker means "nothing listening yet", so the probe retries rather
	// than giving up. The node must therefore not be marked ready.
	h := NewHarness(t, WithProvider(func(p *FakeProvider) {
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

	assert.False(t, findNode(t, labOut.Instance.Nodes, NodeHost).IsReady,
		"a node with nothing listening must stay not-ready while the probe retries")
	assert.Equal(t, int(deployment.NodeStates.Running), findNode(t, labOut.Instance.Nodes, NodeHost).State,
		"but it is still reported as running")
}

func TestStartupProbe_ProbeErrorMarksTheNodeStopped(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *FakeProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			return "", 0, errFakeProvider
		}
	}))

	h.DeployLab(LabAdminID)

	// waitForNodeStarted returns the error, and the listener then reports the node as stopped.
	waitForNodeState(t, h, LabAdminID, NodeHost, deployment.NodeStates.Stopped)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)

	assert.False(t, findNode(t, labOut.Instance.Nodes, NodeHost).IsReady)
}

func TestStartupProbe_UnexpectedExitCodeMarksTheNodeStopped(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *FakeProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			// Anything outside the handled set is treated as a hard failure.
			return "something unexpected", 42, nil
		}
	}))

	h.DeployLab(LabAdminID)

	waitForNodeState(t, h, LabAdminID, NodeHost, deployment.NodeStates.Stopped)
}

func TestStartupProbe_RetriesWhileTheNodeIsNotRunningYet(t *testing.T) {
	var attempts int

	h := NewHarness(t, WithProvider(func(p *FakeProvider) {
		p.ExecFn = func(string, string, []string) (string, int, error) {
			attempts++

			// The first probe reports the container as not running, which is a retry condition
			// rather than a failure.
			if attempts == 1 {
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

		return findNode(t, labOut.Instance.Nodes, NodeHost).IsReady
	}, "the node must become ready after the retry")

	assert.GreaterOrEqual(t, attempts, 2, "the probe must have retried")
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

		return findNode(t, labOut.Instance.Nodes, NodeHost).IsReady
	}, "the node must become ready")

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	host := findNode(t, labOut.Instance.Nodes, NodeHost)
	assert.Equal(t, []string{"eth0"}, interfaceNames(host.Interfaces),
		"both excluded patterns must be dropped")
}

func TestStartupProbe_InterfaceFailureLeavesTheNodeReadyWithNoInterfaces(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *FakeProvider) {
		p.InterfacesFn = func(string, string) ([]deployment.NodeInterface, error) {
			return nil, errFakeProvider
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

		return findNode(t, labOut.Instance.Nodes, NodeHost).IsReady
	}, "the node must still become ready")

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	assert.Empty(t, findNode(t, labOut.Instance.Nodes, NodeHost).Interfaces)
}

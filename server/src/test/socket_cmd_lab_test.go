package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/statusmessage"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/utils/serverlog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * deployLab
 */

func TestDeployCommand_OwnerCanDeploy(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	require.True(t, h.InstanceService.IsRunning(LabAdminID))

	call := h.Provider.LastCall("Deploy")
	require.NotNil(t, call)
	assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
	assert.Equal(t, h.Storage.GetRunTopologyFile(LabAdminID), call.Args["topologyFile"],
		"the provider must be handed the lab's run environment, not the topology source")
}

func TestDeployCommand_AdminCanDeploySomeoneElsesLab(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.AdminBare.Token)

	client.Emit(deployCommand(LabMemberID)).RequireOk(nil)

	assert.True(t, h.InstanceService.IsRunning(LabMemberID))
}

func TestDeployCommand_UnknownLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(deployCommand("no-such-lab")).RequireError(5011)
	assert.Contains(t, errorResponse.Message, "lab has not been found")
}

// TestDeployCommand_NonOwnerIsForbidden covers the permission check on deploy.
//
// validateLabCommand refuses a non-owner with utils.ErrNoDeployAccessToLab, which was missing from
// the 5403 group in utils.CreateSocketErrorResponse and so arrived as the generic 5000 — leaving a
// client unable to tell "you may not do this" apart from "the server broke".
func TestDeployCommand_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Member.Token)

	errorResponse := client.Emit(deployCommand(LabAdminID)).RequireError(5403)

	assert.Contains(t, errorResponse.Message, "deploy access to the provided lab is not granted")
	assert.False(t, h.InstanceService.IsRunning(LabAdminID))
}

func TestDeployCommand_EmitsALabUpdate(t *testing.T) {
	h := NewHarness(t)

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	var update instanceUpdatePayload
	updates.NextPayload(&update)

	require.NotNil(t, update.LabId)
	assert.Equal(t, LabAdminID, *update.LabId)
}

func TestDeployCommand_StreamsProviderOutputToTheLabLog(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	// The log namespace only exists once the lab has been deployed, so subscribe afterwards and
	// read the backlog.
	logs := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)

	var lines []string
	decodeInto(t, logs.NextBacklog(), &lines)

	joined := ""
	for _, line := range lines {
		joined += line + "\n"
	}

	assert.Contains(t, joined, "Deploying lab "+InstanceAdminLab)
	assert.Contains(t, joined, "2 nodes ready")
}

func TestDeployCommand_SendsProgressAndSuccessStatusMessages(t *testing.T) {
	h := NewHarness(t)

	status := h.Dial("/status-messages", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	// Assert on the set rather than the sequence: socket delivery is not order preserving.
	messages := CollectPayloads[statusmessage.Message](status, 2)

	progress := findStatusMessage(t, messages, serverlog.InfoLevel)
	assert.Contains(t, progress.Content, "Deploying lab")
	assert.Equal(t, "Runtime", progress.Source)

	success := findStatusMessage(t, messages, serverlog.SuccessLevel)
	assert.Contains(t, success.Content, "Successfully deployed lab")
	assert.NotEmpty(t, success.ID)
	assert.False(t, success.Timestamp.IsZero())
}

func TestDeployCommand_ClearsTheLastDeployFailedFlag(t *testing.T) {
	h := NewHarness(t)

	// Mark the topology as previously broken.
	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)
	h.TopologyService.SetLastDeployFailed(t.Context(), stored, true)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	refreshed, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)
	assert.False(t, refreshed.LastDeployFailed, "a successful deployment must clear the flag")
}

func TestDeployCommand_ProviderFailureIsReported(t *testing.T) {
	h := NewHarness(t)

	h.Provider.DeployFn = func(string, string, deployment.LogFunc) error { return deployment.ErrDummyProvider }

	status := h.Dial("/status-messages", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(deployCommand(LabAdminID)).RequireError(5500)
	assert.Contains(t, errorResponse.Message, "provider subprocess encountered an error")

	// The instance sticks around in the Failed state so the user can see and delete it.
	labInstance := h.InstanceService.GetInstance(LabAdminID)
	require.NotNil(t, labInstance)
	assert.Equal(t, instance.InstanceStates.Failed, labInstance.State)
	assert.True(t, h.InstanceService.CanDelete(LabAdminID))

	// And the topology is flagged so the UI can surface it.
	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)
	assert.True(t, stored.LastDeployFailed)

	// An error status message must have been broadcast alongside the progress one.
	messages := CollectPayloads[statusmessage.Message](status, 2)

	failure := findStatusMessage(t, messages, serverlog.ErrorLevel)
	assert.Contains(t, failure.Content, "Failed to deploy lab")
}

func TestDeployCommand_InspectFailureIsReported(t *testing.T) {
	h := NewHarness(t)

	// Deploy succeeds but the follow-up inspection does not.
	h.Provider.InspectLabFn = func(string, string) ([]deployment.InspectContainer, error) {
		return nil, deployment.ErrDummyProvider
	}

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(deployCommand(LabAdminID)).RequireError(5500)

	labInstance := h.InstanceService.GetInstance(LabAdminID)
	require.NotNil(t, labInstance)
	assert.Equal(t, instance.InstanceStates.Failed, labInstance.State)

	// The nodes come from the topology and stay, but without inspect output nothing is known to run.
	assert.Len(t, labInstance.Nodes, 2)
	for _, node := range []string{NodeHost, NodeSRL} {
		assert.Equalf(t, deployment.NodeStates.Stopped, nodeState(t, h, LabAdminID, node),
			"node %s must be stopped after a failed inspection", node)
	}
}

func TestDeployCommand_RedeploysAnAlreadyRunningLab(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)
	require.Equal(t, 1, h.Provider.CallCount("Deploy"))

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	assert.Equal(t, 1, h.Provider.CallCount("Deploy"), "the second deploy must not call Deploy again")
	assert.Equal(t, 1, h.Provider.CallCount("Redeploy"), "it must call Redeploy instead")
	assert.True(t, h.InstanceService.IsRunning(LabAdminID))
}

func TestDeployCommand_ClearsTheEndTimeOfAnExpiredLab(t *testing.T) {
	h := NewHarness(t)

	before, err := h.LabRepo.GetByUuid(t.Context(), LabPastID)
	require.NoError(t, err)
	require.NotNil(t, before.EndTime)
	require.True(t, before.EndTime.Before(time.Now()))

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabPastID)).RequireOk(nil)

	// Deploying a lab whose window has already closed makes it indefinite rather than having it
	// destroyed again immediately.
	after, err := h.LabRepo.GetByUuid(t.Context(), LabPastID)
	require.NoError(t, err)
	assert.Nil(t, after.EndTime)
}

func TestDeployCommand_LeavesAFutureEndTimeAlone(t *testing.T) {
	h := NewHarness(t)

	before, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	require.NotNil(t, before.EndTime)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	after, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	require.NotNil(t, after.EndTime)
	assert.WithinDuration(t, *before.EndTime, *after.EndTime, time.Second)
}

func TestDeployCommand_PublishesManuallyDeployed(t *testing.T) {
	h := NewHarness(t)

	events := h.RecordLabEvents("lab.manually-deployed")

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	assert.Equal(t, []string{LabAdminID}, events.LabIdsFor("lab.manually-deployed"))
}

func TestDeployCommand_MarksNodesReadyWithTheirInterfaces(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	// The startup listeners run asynchronously, so wait for them to settle.
	requireEventually(t, func() bool {
		labInstance := h.InstanceService.GetInstance(LabAdminID)
		if labInstance == nil {
			return false
		}

		labInstance.DataMutex.Lock()
		defer labInstance.DataMutex.Unlock()

		for _, node := range labInstance.Nodes {
			if !node.IsReady {
				return false
			}
		}

		return len(labInstance.Nodes) == 2
	}, "every node must eventually be marked ready")

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)

	host := findNode(t, labOut.Instance.Nodes, NodeHost)

	assert.True(t, host.IsReady)
	assert.Equal(t, int(deployment.NodeStates.Running), host.State)
	assert.Equal(t, "container-"+NodeHost, host.ContainerId)
	assert.Equal(t, "172.20.20.2", host.IPv4)

	// "lo" is in the excluded list, so the interface filter must have dropped it.
	assert.ElementsMatch(t, []string{"eth0", "eth1"}, interfaceNames(host.Interfaces))
}

func TestDeployCommand_AppliesTheNodeKindRestartPolicy(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)
	require.NotNil(t, labOut.Instance)

	// The kinds config marks linux as restartable and leaves nokia_srlinux at the default.
	assert.True(t, findNode(t, labOut.Instance.Nodes, NodeHost).CanRestart)
	assert.False(t, findNode(t, labOut.Instance.Nodes, NodeSRL).CanRestart)
}

/*
 * destroyLab
 */

func TestDestroyCommand_TearsDownARunningLab(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)

	assert.False(t, h.InstanceService.IsRunning(LabAdminID), "the instance must be dropped")
	assert.Nil(t, h.InstanceService.GetInstance(LabAdminID))

	call := h.Provider.LastCall("Destroy")
	require.NotNil(t, call)
	assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
}

func TestDestroyCommand_NonRunningLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(destroyCommand(LabAdminID)).RequireError(5012)

	assert.Contains(t, errorResponse.Message, "lab is not running")
	assert.False(t, h.Provider.WasCalled("Destroy"))
}

func TestDestroyCommand_UnknownLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(destroyCommand("no-such-lab")).RequireError(5011)
}

func TestDestroyCommand_NonOwnerIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Member.Token)

	client.Emit(destroyCommand(LabAdminID)).RequireError(5403)

	assert.True(t, h.InstanceService.IsRunning(LabAdminID), "the lab must still be running")
}

func TestDestroyCommand_SendsASuccessStatusMessage(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	status := h.Dial("/status-messages", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)

	messages := CollectPayloads[statusmessage.Message](status, 2)

	progress := findStatusMessage(t, messages, serverlog.InfoLevel)
	assert.Contains(t, progress.Content, "Destroying lab")

	success := findStatusMessage(t, messages, serverlog.SuccessLevel)
	assert.Contains(t, success.Content, "Successfully destroyed lab")
}

func TestDestroyCommand_EmitsALabUpdate(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)

	var update instanceUpdatePayload
	updates.NextPayload(&update)

	require.NotNil(t, update.LabId)
	assert.Equal(t, LabAdminID, *update.LabId)
}

func TestDestroyCommand_ProviderFailureLeavesTheLabFailed(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	h.Provider.DestroyFn = func(string, string, deployment.LogFunc) error { return deployment.ErrDummyProvider }

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(destroyCommand(LabAdminID)).RequireError(5500)
	assert.Contains(t, errorResponse.Message, "provider subprocess encountered an error")

	labInstance := h.InstanceService.GetInstance(LabAdminID)
	require.NotNil(t, labInstance, "a failed destruction must not drop the instance")
	assert.Equal(t, instance.InstanceStates.Failed, labInstance.State)
}

func TestDestroyCommand_PublishesLabDeleted(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	events := h.RecordLabEvents("lab.deleted")

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)

	assert.Equal(t, []string{LabAdminID}, events.LabIdsFor("lab.deleted"))
}

func TestDestroyCommand_AllowsRedeploymentAfterwards(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)
	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)
	client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

	assert.True(t, h.InstanceService.IsRunning(LabAdminID))

	// A fresh instance means Deploy rather than Redeploy.
	assert.Equal(t, 2, h.Provider.CallCount("Deploy"))
	assert.Zero(t, h.Provider.CallCount("Redeploy"))
}

func TestDestroyCommand_MarksEveryNodeStopped(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// Capture the instance before it is dropped so the node states can be inspected.
	labInstance := h.InstanceService.GetInstance(LabAdminID)
	require.NotNil(t, labInstance)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(destroyCommand(LabAdminID)).RequireOk(nil)

	labInstance.DataMutex.Lock()
	defer labInstance.DataMutex.Unlock()

	for _, node := range labInstance.Nodes {
		assert.Equalf(t, deployment.NodeStates.Stopped, node.State,
			"node %s must be reported stopped", node.Name)
		assert.Emptyf(t, node.Interfaces, "node %s must have no interfaces left", node.Name)
	}
}

/*
 * Helpers.
 */

// findStatusMessage picks the message with a given severity out of a batch, failing if there is
// none. Used instead of positional access because socket delivery order is not guaranteed.
func findStatusMessage(
	t *testing.T,
	messages []statusmessage.Message,
	severity serverlog.LogLevel,
) statusmessage.Message {
	t.Helper()

	for _, message := range messages {
		if message.Severity == severity {
			return message
		}
	}

	received := make([]string, 0, len(messages))
	for _, message := range messages {
		received = append(received, message.Severity.String()+":"+message.Content)
	}

	t.Fatalf("no %s status message among %v", severity, received)

	return statusmessage.Message{}
}

// requireEventually polls a condition until it holds or the standard socket timeout expires.
func requireEventually(t *testing.T, condition func() bool, message string) {
	t.Helper()

	requireEventuallyWithin(t, socketTimeout, condition, message)
}

// requireEventuallyWithin polls a condition until it holds or the given timeout expires.
//
// Used with a longer budget where each attempt is itself a full socket round trip, so the default
// five seconds only affords a handful of tries.
func requireEventuallyWithin(t *testing.T, timeout time.Duration, condition func() bool, message string) {
	t.Helper()

	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if condition() {
			return
		}

		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal(message)
}

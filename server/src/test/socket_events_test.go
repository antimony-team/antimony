package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/runtime/instance"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * Deployment backend events.
 *
 * instance.registerProviderEventListener hands the provider a callback that is invoked whenever a
 * container changes. The service finds the instance the node belongs to, re-inspects it and only
 * broadcasts a lab update when the node's state actually moved.
 */

func TestProviderEvent_ListenerIsRegisteredOnStartup(t *testing.T) {
	h := NewHarness(t)

	requireEventually(t, func() bool {
		return h.Provider.WasCalled("RegisterListener")
	}, "the instance service must register a provider event listener on startup")
}

func TestProviderEvent_StateChangeBroadcastsALabUpdate(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	// Move the node behind the service's back, then tell the service something happened.
	h.Provider.SetNodeState(InstanceAdminLab, NodeHost, deployment.NodeStates.Stopped)

	requireEventually(t, func() bool {
		require.True(t, h.Provider.FireNodeEvent(NodeHost), "a listener must be registered")

		_, ok := updates.NextDataWithin(200 * time.Millisecond)

		return ok
	}, "a node state change must broadcast a lab update")

	// And the change must be reflected in the instance.
	assert.Equal(t, deployment.NodeStates.Stopped, nodeState(t, h, LabAdminID, NodeHost))
}

func TestProviderEvent_UnchangedStateBroadcastsNothing(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// Wait for the startup listeners to finish so their updates do not confuse the assertion.
	requireEventually(t, func() bool {
		return h.Provider.WasCalled("GetNetworkInterfaces")
	}, "the startup listeners must settle first")

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	// The node is running and the provider still reports it as running, so fetchNode short-circuits
	// and nothing is broadcast.
	require.True(t, h.Provider.FireNodeEvent(NodeHost))

	updates.ExpectNoData()
}

func TestProviderEvent_UnknownNodeIsIgnored(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	// A container that belongs to no tracked instance must be dropped silently.
	require.True(t, h.Provider.FireNodeEvent("a-node-nobody-knows"))

	updates.ExpectNoData()
}

func TestProviderEvent_EventForANodeOfANonRunningLabIsIgnored(t *testing.T) {
	h := NewHarness(t)

	// Nothing is deployed, so there is no instance holding this node.
	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	require.True(t, h.Provider.FireNodeEvent(NodeHost))

	updates.ExpectNoData()
}

func TestProviderEvent_EventIsRoutedToTheOwningInstance(t *testing.T) {
	h := NewHarness(t)

	// Two labs are running. Both topologies declare a node called host1, so the lookup is by node
	// name across every instance and the first match wins.
	h.DeployLab(LabAdminID)
	h.DeployLab(LabMemberID)

	updates := h.Dial("/lab-updates", h.Seed.Admin.Token)

	h.Provider.SetNodeState(InstanceAdminLab, NodeHost, deployment.NodeStates.Stopped)
	h.Provider.SetNodeState(InstanceMemberLab, NodeHost, deployment.NodeStates.Stopped)

	requireEventually(t, func() bool {
		require.True(t, h.Provider.FireNodeEvent(NodeHost))

		value, ok := updates.NextDataWithin(200 * time.Millisecond)
		if !ok {
			return false
		}

		var update instanceUpdatePayload
		DecodePayload(t, value, &update)

		require.NotNil(t, update.LabId)

		// Whichever instance was matched, the update must name one of the two running labs.
		return *update.LabId == LabAdminID || *update.LabId == LabMemberID
	}, "the update must be attributed to a running lab")
}

/*
 * Revive on startup.
 *
 * instance.CreateService cross-references the labs in the database against the containers the
 * provider reports, so a restart of the server picks up labs that are still running.
 */

func TestRevive_AdoptsAnAlreadyRunningLab(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		// The instance names of the seeded labs are fixed constants precisely so this can be set
		// up before the harness seeds anything.
		p.SeedInstance(InstanceAdminLab,
			deployment.DummyNode{Name: NodeHost, Kind: "linux", State: deployment.NodeStates.Running},
			deployment.DummyNode{Name: NodeSRL, Kind: "nokia_srlinux", State: deployment.NodeStates.Running},
		)
	}))

	require.True(t, h.InstanceService.IsRunning(LabAdminID),
		"a lab whose containers are still up must be adopted on startup")

	labInstance := h.InstanceService.GetInstance(LabAdminID)
	require.NotNil(t, labInstance)

	assert.True(t, labInstance.Recovered, "an adopted instance must be flagged as recovered")
	assert.Equal(t, instance.InstanceStates.Running, labInstance.State)
	assert.Equal(t, InstanceAdminLab, labInstance.Name)
	assert.Len(t, labInstance.Nodes, 2)

	// And the lab must be handed to the scheduler for destruction at its end time.
	assert.Contains(t, h.StartupEvents.LabIdsFor("lab.restored"), LabAdminID)
}

func TestRevive_ReportsTheAdoptedInstanceOverHttp(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.SeedInstance(InstanceAdminLab,
			deployment.DummyNode{Name: NodeHost, Kind: "linux", State: deployment.NodeStates.Running},
		)
	}))

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	require.NotNil(t, labOut.Instance)
	assert.True(t, labOut.Instance.IsRecovered)
	assert.Equal(t, int(instance.InstanceStates.Running), labOut.Instance.State)
}

func TestRevive_SkipsStoppedContainers(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.SeedInstance(InstanceAdminLab,
			deployment.DummyNode{Name: NodeHost, Kind: "linux", State: deployment.NodeStates.Running},
			deployment.DummyNode{Name: NodeSRL, Kind: "nokia_srlinux", State: deployment.NodeStates.Stopped},
		)
	}))

	labInstance := h.InstanceService.GetInstance(LabAdminID)
	require.NotNil(t, labInstance)

	// Both nodes are adopted, but only the running one gets a log stream attached.
	assert.Len(t, labInstance.Nodes, 2)

	assert.True(t, h.Provider.PushContainerLog(InstanceAdminLab, NodeHost, "line"),
		"a running node must have a log stream")
	assert.False(t, h.Provider.PushContainerLog(InstanceAdminLab, NodeSRL, "line"),
		"a stopped node must not")
}

func TestRevive_SchedulesLabsThatHaveNotStartedYet(t *testing.T) {
	h := NewHarness(t)

	// Nothing is running, so the only lab handed to the scheduler is the one whose start time is
	// still in the future.
	created := h.StartupEvents.LabIdsFor("lab.created")

	assert.Contains(t, created, LabFutureID)
	assert.NotContains(t, created, LabAdminID, "a lab whose window already opened is not rescheduled")
	assert.NotContains(t, created, LabPastID, "nor is one whose window has closed")
}

func TestRevive_DoesNothingForAnEmptyDatabase(t *testing.T) {
	h := NewHarness(t, WithoutSeed())

	assert.Empty(t, h.StartupEvents.Events())
	assert.False(t, h.InstanceService.IsRunning(LabAdminID))
}

func TestRevive_IgnoresContainersWithNoMatchingLab(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		// An instance the database knows nothing about, left over from a manual clab deploy.
		p.SeedInstance("some-other-instance",
			deployment.DummyNode{Name: "stray", Kind: "linux", State: deployment.NodeStates.Running},
		)
	}))

	// It must neither be adopted nor cause the revive pass to fail.
	assert.False(t, h.InstanceService.IsRunning(LabAdminID))
	assert.Empty(t, h.StartupEvents.LabIdsFor("lab.restored"))
}

func TestRevive_AttachesStartupListenersToAdoptedNodes(t *testing.T) {
	h := NewHarness(t, WithProvider(func(p *deployment.DummyProvider) {
		p.SeedInstance(InstanceAdminLab,
			deployment.DummyNode{Name: NodeHost, Kind: "linux", State: deployment.NodeStates.Running},
		)
	}))

	// A revived running node still needs its readiness probe and interface fetch, otherwise it
	// would never be reported as ready after a restart.
	requireEventually(t, func() bool {
		return h.Provider.WasCalled("GetNetworkInterfaces")
	}, "an adopted node must get a startup listener")

	requireEventually(t, func() bool {
		var labOut labDTO
		h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

		if labOut.Instance == nil {
			return false
		}

		return findNode(t, labOut.Instance.Nodes, NodeHost).IsReady
	}, "an adopted node must end up marked ready")
}

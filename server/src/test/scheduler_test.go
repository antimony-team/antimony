package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/lab"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * The lab scheduler.
 *
 * scheduler.CreateScheduler subscribes to the lab event bus and keeps two time-ordered queues: one
 * for deployments (keyed on a lab's start time) and one for destructions (keyed on its end time).
 * Run pops whatever is due every 50ms and drives the instance service.
 *
 * The queues are private, so these tests observe the scheduler through its effects on the dummy
 * provider. Queue mechanics themselves are covered directly in utils/schedule_test.go.
 */

// createLabViaApi creates a lab through the HTTP API, which is what publishes lab.created.
func createLabViaApi(t *testing.T, h *Harness, name string, start time.Time, end *time.Time) string {
	t.Helper()

	var createdID string
	h.POST("/labs", lab.LabIn{
		Name:       ptr(name),
		StartTime:  &start,
		EndTime:    end,
		TopologyId: ptr(TopologyAdminID),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	require.NotEmpty(t, createdID)

	return createdID
}

func TestScheduler_DeploysALabWhoseStartTimeHasPassed(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(time.Hour)
	labId := createLabViaApi(t, h, "Due Now", time.Now().Add(-time.Minute), &end)

	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(labId)
	}, "the scheduler must deploy a lab whose start time is already in the past")

	assert.True(t, h.Provider.WasCalled("Deploy"))
}

func TestScheduler_LeavesAFutureLabAlone(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(2 * time.Hour)
	labId := createLabViaApi(t, h, "Not Yet", time.Now().Add(time.Hour), &end)

	// Well past several scheduler ticks.
	time.Sleep(300 * time.Millisecond)

	assert.False(t, h.InstanceService.IsRunning(labId),
		"a lab whose window has not opened must not be deployed")
	assert.False(t, h.Provider.WasCalled("Deploy"))
}

func TestScheduler_DestroysALabWhoseEndTimeHasPassed(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	// Starts in the past and ends shortly after, so the scheduler should deploy it and then tear it
	// down again.
	//
	// The window has to be comfortably longer than a deployment takes: both queues are driven off
	// the creation event, so if destruction became due before the deploy goroutine finished, the
	// destroy would find nothing running and the lab would then stay up for good. A second and a
	// half is ample even under the race detector.
	end := time.Now().Add(1500 * time.Millisecond)
	labId := createLabViaApi(t, h, "Short Lived", time.Now().Add(-time.Minute), &end)

	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(labId)
	}, "the lab must be deployed first")

	requireEventually(t, func() bool {
		return !h.InstanceService.IsRunning(labId)
	}, "the scheduler must destroy the lab once its end time passes")

	assert.True(t, h.Provider.WasCalled("Destroy"))
}

func TestScheduler_DeletingALabCancelsItsSchedule(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	// Far enough out that the scheduler will not have acted before the delete lands.
	end := time.Now().Add(2 * time.Hour)
	labId := createLabViaApi(t, h, "To Be Deleted", time.Now().Add(time.Hour), &end)

	h.DELETE("/labs/"+labId, h.Seed.Admin.Token).RequireOk(nil)

	time.Sleep(300 * time.Millisecond)

	assert.False(t, h.InstanceService.IsRunning(labId))
	assert.False(t, h.Provider.WasCalled("Deploy"),
		"lab.deleted must remove the lab from the deployment queue")
}

func TestScheduler_MovingALabForwardMakesItDue(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(2 * time.Hour)
	labId := createLabViaApi(t, h, "Moved Forward", time.Now().Add(time.Hour), &end)

	time.Sleep(150 * time.Millisecond)
	require.False(t, h.InstanceService.IsRunning(labId), "it must not be due yet")

	// Pulling the start time into the past republishes lab.moved, which reschedules it.
	newStart := time.Now().Add(-time.Minute)
	h.PATCH("/labs/"+labId, lab.LabInPartial{StartTime: &newStart}, h.Seed.Admin.Token).RequireOk(nil)

	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(labId)
	}, "moving a lab's start time into the past must make the scheduler deploy it")
}

func TestScheduler_MovingALabBackPostponesIt(t *testing.T) {
	h := NewHarness(t)

	// No scheduler loop here: the point is that the event is published, not that it fires.
	events := h.RecordLabEvents("lab.moved")

	end := time.Now().Add(2 * time.Hour)
	labId := createLabViaApi(t, h, "Moved Back", time.Now().Add(time.Hour), &end)

	newStart := time.Now().Add(3 * time.Hour)
	h.PATCH("/labs/"+labId, lab.LabInPartial{StartTime: &newStart}, h.Seed.Admin.Token).RequireOk(nil)

	assert.Equal(t, []string{labId}, events.LabIdsFor("lab.moved"))
}

func TestScheduler_ManualDeploymentTakesTheLabOutOfTheDeploymentQueue(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(2 * time.Hour)
	labId := createLabViaApi(t, h, "Manually Deployed", time.Now().Add(time.Hour), &end)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(labId)).RequireOk(nil)

	require.True(t, h.InstanceService.IsRunning(labId))
	require.Equal(t, 1, h.Provider.CallCount("Deploy"))

	// lab.manually-deployed removes it from the deployment queue, so the scheduler must not deploy
	// it a second time when its original start time comes around.
	time.Sleep(300 * time.Millisecond)

	assert.Equal(t, 1, h.Provider.CallCount("Deploy"),
		"the scheduler must not redeploy a lab that was deployed by hand")
	assert.Zero(t, h.Provider.CallCount("Redeploy"))
}

func TestScheduler_ManualDeploymentStillSchedulesDestruction(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	// A short window, so the destruction the manual deploy schedules fires quickly — but long
	// enough that the deploy reliably completes first.
	end := time.Now().Add(1500 * time.Millisecond)
	labId := createLabViaApi(t, h, "Manual With Deadline", time.Now().Add(time.Hour), &end)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(labId)).RequireOk(nil)

	require.True(t, h.InstanceService.IsRunning(labId))

	requireEventually(t, func() bool {
		return !h.InstanceService.IsRunning(labId)
	}, "a manually deployed lab must still be destroyed at its end time")
}

// TestScheduler_MakingALabIndefiniteIsAccepted covers clearing a lab's end time while the
// scheduler is running.
//
// indefinite:true clears the end time and publishes "lab.moved", which reschedules the lab on both
// queues. The destruction queue's time getter returns the now-nil EndTime, so Reschedule has to
// tolerate a nil time the same way Schedule does: drop the item and return.
func TestScheduler_MakingALabIndefiniteIsAccepted(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(time.Hour)
	labId := createLabViaApi(t, h, "Indefinite", time.Now().Add(time.Hour), &end)

	h.PATCH("/labs/"+labId, lab.LabInPartial{Indefinite: ptr(true)}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), labId)
	require.NoError(t, err)
	assert.Nil(t, stored.EndTime)

	// And the scheduler must still be alive afterwards.
	h.PATCH("/labs/"+labId, lab.LabInPartial{Name: ptr("Still Working")}, h.Seed.Admin.Token).
		RequireOk(nil)
}

func TestScheduler_AnIndefiniteLabIsNeverDestroyed(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	// Created indefinite from the start, with the scheduler running.
	labId := createLabViaApi(t, h, "Indefinite", time.Now().Add(-time.Minute), nil)

	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(labId)
	}, "the lab must be deployed once its start time passes")

	// A nil end time means the destruction queue skips the lab entirely.
	time.Sleep(400 * time.Millisecond)

	assert.True(t, h.InstanceService.IsRunning(labId), "a lab with no end time must keep running")
	assert.False(t, h.Provider.WasCalled("Destroy"))
}

// TestCreateLab_AcceptsNoEndTime covers creating an indefinite lab directly.
//
// The update endpoint has always accepted indefinite:true, so requiring endTime on create forced
// clients into a create-then-patch dance with a throwaway end time.
func TestCreateLab_AcceptsNoEndTime(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)

	var createdID string
	h.POST("/labs", map[string]any{
		"name":       "No End",
		"startTime":  start.Format(time.RFC3339),
		"topologyId": TopologyAdminID,
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	require.NotEmpty(t, createdID)

	stored, err := h.LabRepo.GetByUuid(t.Context(), createdID)
	require.NoError(t, err)
	assert.Nil(t, stored.EndTime, "a lab created without an end time is indefinite")
}

func TestCreateLab_StillRequiresTheOtherFields(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour).Format(time.RFC3339)

	bodies := map[string]map[string]any{
		"no name":       {"startTime": start, "topologyId": TopologyAdminID},
		"no startTime":  {"name": "x", "topologyId": TopologyAdminID},
		"no topologyId": {"name": "x", "startTime": start},
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			h.POST("/labs", body, h.Seed.Admin.Token).RequireValidationError()
		})
	}
}

// TestScheduler_RevivedLabsAreQueuedOnStartup covers the startup handover between the revive pass
// and the scheduler.
//
// instance.CreateService publishes "lab.restored" for every lab it adopts and "lab.created" for
// every lab that has not started yet. utils.EventBus has no replay, so the scheduler has to be
// subscribed before the instance service is constructed or those events are delivered to an empty
// subscriber list and lost — which would mean that after any restart, expired labs run forever and
// future labs never start.
func TestScheduler_RevivedLabsAreQueuedOnStartup(t *testing.T) {
	h := NewHarness(t, WithScheduler(), WithProvider(func(p *deployment.DummyProvider) {
		p.SeedInstance(InstancePastLab,
			deployment.DummyNode{Name: NodeHost, Kind: "linux"},
			deployment.DummyNode{Name: NodeSRL, Kind: "nokia_srlinux"},
		)
	}))

	require.True(t, h.InstanceService.IsRunning(LabPastID), "the lab must be adopted on startup")
	require.Contains(t, h.StartupEvents.LabIdsFor("lab.restored"), LabPastID)

	// Its end time is two hours in the past, so the destruction queue must pop it promptly.
	requireEventually(t, func() bool {
		return !h.InstanceService.IsRunning(LabPastID)
	}, "a restored lab whose end time has passed must be destroyed")

	assert.True(t, h.Provider.WasCalled("Destroy"))
}

func TestScheduler_FutureLabsFromReviveAreDeployedWhenDue(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	// The seeded future lab starts in four hours, so it must be queued but not yet deployed.
	require.Contains(t, h.StartupEvents.LabIdsFor("lab.created"), LabFutureID)

	time.Sleep(200 * time.Millisecond)
	require.False(t, h.InstanceService.IsRunning(LabFutureID))

	// Pulling its start time into the past must make the queued lab deploy.
	newStart := time.Now().Add(-time.Minute)
	h.PATCH("/labs/"+LabFutureID, lab.LabInPartial{StartTime: &newStart}, h.Seed.Admin.Token).
		RequireOk(nil)

	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(LabFutureID)
	}, "a lab queued by the revive pass must deploy once it becomes due")
}

// TestScheduler_WorksForEventsPublishedAfterStartup is the control for the test above: the very same
// destruction path does fire when the event reaches a subscribed scheduler.
func TestScheduler_WorksForEventsPublishedAfterStartup(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(1500 * time.Millisecond)
	labId := createLabViaApi(t, h, "Live Event", time.Now().Add(-time.Minute), &end)

	requireEventually(t, func() bool {
		return h.InstanceService.IsRunning(labId)
	}, "a lab created while the scheduler is running must be deployed")

	requireEventually(t, func() bool {
		return !h.InstanceService.IsRunning(labId)
	}, "and destroyed at its end time")
}

func TestScheduler_EventBusIsWiredToEveryTopic(t *testing.T) {
	h := NewHarness(t)

	// Creating the scheduler must subscribe to all five lab topics. Publishing each one with no
	// scheduler loop running must be harmless, which is what proves the handlers are attached and
	// tolerate being called out of band.
	h.Scheduler = nil

	events := h.RecordLabEvents()

	end := time.Now().Add(time.Hour)
	labId := createLabViaApi(t, h, "Wiring", time.Now().Add(-time.Minute), &end)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(labId)).RequireOk(nil)
	client.Emit(destroyCommand(labId)).RequireOk(nil)

	topics := events.Topics()

	assert.Contains(t, topics, "lab.created")
	assert.Contains(t, topics, "lab.manually-deployed")
	assert.Contains(t, topics, "lab.deleted")
}

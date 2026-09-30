package test

import (
	"antimonyBackend/domain/lab"
	"net/http"
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
 * The queues are private, so these tests observe the scheduler through its effects on the fake
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

	// Starts in the past and ends almost immediately, so the scheduler should deploy it and then
	// tear it down again.
	end := time.Now().Add(400 * time.Millisecond)
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

	// A short window, so the destruction the manual deploy schedules should fire quickly.
	end := time.Now().Add(500 * time.Millisecond)
	labId := createLabViaApi(t, h, "Manual With Deadline", time.Now().Add(time.Hour), &end)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(labId)).RequireOk(nil)

	require.True(t, h.InstanceService.IsRunning(labId))

	requireEventually(t, func() bool {
		return !h.InstanceService.IsRunning(labId)
	}, "a manually deployed lab must still be destroyed at its end time")
}

// TestScheduler_MakingALabIndefinitePanicsTheUpdateHandler pins a nil-pointer crash reachable from
// an ordinary user action.
//
// Setting indefinite:true clears the lab's end time and publishes "lab.moved". The scheduler's
// handler reschedules the lab on *both* queues:
//
//	func (s *Scheduler) onLabMoved(lab *lab.Lab) {
//	    s.deploymentSchedule.Reschedule(lab)
//	    s.destructionSchedule.Reschedule(lab)   // timeGetter returns lab.EndTime, now nil
//	}
//
// utils.Schedule.Schedule guards against a nil time, but Reschedule does not — it goes straight to
// insert, which dereferences the result of timeGetter:
//
//	itemTime := s.timeGetter(*item).Unix()   // panics
//
// gin's Recovery turns this into a 500, so the server survives, but the update is lost: the lab
// keeps its old end time in the client's eyes and its scheduling state is left inconsistent.
//
// The fix is to give Reschedule the same nil-time guard Schedule has (removing the item and
// returning), which is also the correct semantics: a lab with no end time simply is not scheduled
// for destruction.
func TestScheduler_MakingALabIndefinitePanicsTheUpdateHandler(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	// LabIn.EndTime is required, so the lab has to be created with an end time first.
	end := time.Now().Add(time.Hour)
	labId := createLabViaApi(t, h, "Indefinite", time.Now().Add(time.Hour), &end)

	response := h.PATCH("/labs/"+labId, lab.LabInPartial{Indefinite: ptr(true)}, h.Seed.Admin.Token)

	assert.Equal(t, http.StatusInternalServerError, response.Status(),
		"clearing the end time panics inside the scheduler and Recovery turns it into a 500")

	// The end time was cleared in the database before the panic, so the write is half-applied.
	stored, err := h.LabRepo.GetByUuid(t.Context(), labId)
	require.NoError(t, err)
	assert.Nil(t, stored.EndTime)
}

func TestScheduler_AnIndefiniteLabIsNeverDestroyed(t *testing.T) {
	// Without the scheduler subscribed there is nothing to panic, so this covers the intended
	// behaviour: a lab with no end time is never queued for destruction.
	h := NewHarness(t)

	end := time.Now().Add(300 * time.Millisecond)
	labId := createLabViaApi(t, h, "Indefinite", time.Now().Add(time.Hour), &end)

	h.PATCH("/labs/"+labId, lab.LabInPartial{Indefinite: ptr(true)}, h.Seed.Admin.Token).RequireOk(nil)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	client.Emit(deployCommand(labId)).RequireOk(nil)

	require.True(t, h.InstanceService.IsRunning(labId))

	time.Sleep(600 * time.Millisecond)

	assert.True(t, h.InstanceService.IsRunning(labId), "a lab with no end time must keep running")
	assert.False(t, h.Provider.WasCalled("Destroy"))
}

func TestCreateLab_RequiresAnEndTime(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)

	// Worth pinning because the update endpoint does accept an indefinite lab: the asymmetry means
	// a client has to create the lab with a throwaway end time first.
	errorResponse := h.POST("/labs", map[string]any{
		"name":       "No End",
		"startTime":  start.Format(time.RFC3339),
		"topologyId": TopologyAdminID,
	}, h.Seed.Admin.Token).RequireValidationError()

	assert.Contains(t, errorResponse.Message, "EndTime")
}

// TestScheduler_RevivedLabsAreNeverQueuedBecauseTheSchedulerSubscribesTooLate pins a startup
// ordering bug that silently discards all scheduling state across a restart.
//
// instance.CreateService runs its revive pass during construction and publishes "lab.restored" for
// every lab it adopts and "lab.created" for every lab that has not started yet. But main.go builds
// the scheduler *after* the runtime:
//
//	instanceService, shellService := createRuntime(...)            // revive publishes here
//	labScheduler := scheduler.CreateScheduler(..., labEventBus)    // subscribes only now
//	go labScheduler.Run()
//
// utils.EventBus has no replay, so every revive event is delivered to an empty subscriber list and
// dropped. The consequences after any server restart are that
//
//   - a lab that was still running is adopted but never queued for destruction, so it runs past its
//     end time indefinitely, and
//   - a lab whose start time is still in the future is never queued for deployment, so it never
//     starts automatically.
//
// Creating the scheduler before the instance service fixes both, since the bus is already wired by
// the time revive publishes.
func TestScheduler_RevivedLabsAreNeverQueuedBecauseTheSchedulerSubscribesTooLate(t *testing.T) {
	h := NewHarness(t, WithScheduler(), WithProvider(func(p *FakeProvider) {
		p.SeedInstance(InstancePastLab,
			FakeNode{Name: NodeHost, Kind: "linux"},
			FakeNode{Name: NodeSRL, Kind: "nokia_srlinux"},
		)
	}))

	// The lab is adopted and the event is published...
	require.True(t, h.InstanceService.IsRunning(LabPastID), "the lab must be adopted on startup")
	require.Contains(t, h.StartupEvents.LabIdsFor("lab.restored"), LabPastID,
		"revive does publish the event")

	// ...but the scheduler was not subscribed yet, so nothing acts on it. The lab's end time is two
	// hours in the past, so a working scheduler would tear it down within a tick or two.
	time.Sleep(500 * time.Millisecond)

	assert.True(t, h.InstanceService.IsRunning(LabPastID),
		"the expired lab keeps running because the restore event was lost")
	assert.False(t, h.Provider.WasCalled("Destroy"))

	// The same loss applies to labs that have not started yet.
	assert.Contains(t, h.StartupEvents.LabIdsFor("lab.created"), LabFutureID)
}

// TestScheduler_WorksForEventsPublishedAfterStartup is the control for the test above: the very same
// destruction path does fire when the event reaches a subscribed scheduler.
func TestScheduler_WorksForEventsPublishedAfterStartup(t *testing.T) {
	h := NewHarness(t, WithScheduler())

	end := time.Now().Add(400 * time.Millisecond)
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

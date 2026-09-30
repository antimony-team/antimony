package utils

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// scheduleItem is the element type used by the schedule tests.
type scheduleItem struct {
	Key  string
	Time *time.Time
}

func newSchedule() *Schedule[scheduleItem] {
	return CreateSchedule[scheduleItem](
		func(item scheduleItem) string { return item.Key },
		func(item scheduleItem) *time.Time { return item.Time },
	)
}

func at(offset time.Duration) *time.Time {
	value := time.Now().Add(offset)

	return &value
}

func TestSchedule_StartsEmpty(t *testing.T) {
	schedule := newSchedule()

	assert.False(t, schedule.IsScheduled("anything"))
	assert.Nil(t, schedule.TryPop())
}

func TestSchedule_SchedulesAnItem(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(time.Hour)})

	assert.True(t, schedule.IsScheduled("a"))
}

func TestSchedule_IgnoresItemsWithoutATime(t *testing.T) {
	schedule := newSchedule()

	// A nil time means "no end time"; such an item must never be scheduled.
	schedule.Schedule(&scheduleItem{Key: "indefinite", Time: nil})

	assert.False(t, schedule.IsScheduled("indefinite"))
	assert.Nil(t, schedule.TryPop())
}

func TestSchedule_TryPopWaitsUntilTheItemIsDue(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "future", Time: at(time.Hour)})

	assert.Nil(t, schedule.TryPop(), "an item in the future must not be popped")
	assert.True(t, schedule.IsScheduled("future"), "and it must stay scheduled")
}

func TestSchedule_TryPopReturnsDueItems(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "due", Time: at(-time.Minute)})

	popped := schedule.TryPop()
	require.NotNil(t, popped)

	assert.Equal(t, "due", popped.Key)
	assert.False(t, schedule.IsScheduled("due"), "popping must remove the item")
	assert.Nil(t, schedule.TryPop(), "the schedule must now be empty")
}

func TestSchedule_PopsInChronologicalOrder(t *testing.T) {
	schedule := newSchedule()

	// Inserted out of order on purpose.
	schedule.Schedule(&scheduleItem{Key: "third", Time: at(-1 * time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "first", Time: at(-3 * time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "second", Time: at(-2 * time.Minute)})

	order := make([]string, 0, 3)
	for range 3 {
		popped := schedule.TryPop()
		require.NotNil(t, popped)

		order = append(order, popped.Key)
	}

	assert.Equal(t, []string{"first", "second", "third"}, order)
}

func TestSchedule_OnlyPopsTheItemsThatAreDue(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "past", Time: at(-time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "future", Time: at(time.Hour)})

	popped := schedule.TryPop()
	require.NotNil(t, popped)
	assert.Equal(t, "past", popped.Key)

	assert.Nil(t, schedule.TryPop(), "the future item must stay put")
	assert.True(t, schedule.IsScheduled("future"))
}

func TestSchedule_RemoveDropsAScheduledItem(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-time.Minute)})
	schedule.Remove("a")

	assert.False(t, schedule.IsScheduled("a"))
	assert.Nil(t, schedule.TryPop())
}

func TestSchedule_RemoveUnknownKeyIsANoOp(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-time.Minute)})

	assert.NotPanics(t, func() { schedule.Remove("does-not-exist") })
	assert.True(t, schedule.IsScheduled("a"), "the unrelated item must survive")
}

func TestSchedule_RemoveKeepsTheOrderOfTheRest(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "first", Time: at(-3 * time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "second", Time: at(-2 * time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "third", Time: at(-1 * time.Minute)})

	schedule.Remove("second")

	order := make([]string, 0, 2)
	for range 2 {
		popped := schedule.TryPop()
		require.NotNil(t, popped)

		order = append(order, popped.Key)
	}

	assert.Equal(t, []string{"first", "third"}, order)
	assert.Nil(t, schedule.TryPop())
}

func TestSchedule_RescheduleMovesAnItemLater(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-time.Minute)})

	// Pushing it into the future must make it no longer poppable.
	schedule.Reschedule(&scheduleItem{Key: "a", Time: at(time.Hour)})

	assert.True(t, schedule.IsScheduled("a"))
	assert.Nil(t, schedule.TryPop())
}

func TestSchedule_RescheduleMovesAnItemEarlier(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(time.Hour)})
	schedule.Reschedule(&scheduleItem{Key: "a", Time: at(-time.Minute)})

	popped := schedule.TryPop()
	require.NotNil(t, popped)
	assert.Equal(t, "a", popped.Key)
}

func TestSchedule_RescheduleDoesNotDuplicate(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-2 * time.Minute)})
	schedule.Reschedule(&scheduleItem{Key: "a", Time: at(-time.Minute)})

	require.NotNil(t, schedule.TryPop())
	assert.Nil(t, schedule.TryPop(), "rescheduling must replace rather than add")
}

func TestSchedule_RescheduleAnUnknownItemSchedulesIt(t *testing.T) {
	schedule := newSchedule()

	schedule.Reschedule(&scheduleItem{Key: "fresh", Time: at(-time.Minute)})

	assert.True(t, schedule.IsScheduled("fresh"))
}

func TestSchedule_RescheduleReordersRelativeToOtherItems(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-3 * time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "b", Time: at(-2 * time.Minute)})

	// Move a behind b.
	schedule.Reschedule(&scheduleItem{Key: "a", Time: at(-time.Minute)})

	first := schedule.TryPop()
	require.NotNil(t, first)

	second := schedule.TryPop()
	require.NotNil(t, second)

	assert.Equal(t, "b", first.Key)
	assert.Equal(t, "a", second.Key)
}

func TestSchedule_SchedulingTheSameKeyTwiceKeepsBothEntries(t *testing.T) {
	schedule := newSchedule()

	// Schedule (unlike Reschedule) does not de-duplicate: the map only tracks the latest pointer,
	// so the slice ends up holding two entries and only one of them is reachable by key. This
	// documents the current behaviour, which is why the scheduler always uses Reschedule for moves.
	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-2 * time.Minute)})
	schedule.Schedule(&scheduleItem{Key: "a", Time: at(-1 * time.Minute)})

	require.NotNil(t, schedule.TryPop())
	assert.NotNil(t, schedule.TryPop(), "the duplicate entry is still in the queue")
}

// TestSchedule_RescheduleWithoutATimePanics pins the root cause of a server-side crash.
//
// Schedule skips an item whose time is nil, but Reschedule has no such guard and goes straight to
// insert, which dereferences the result of timeGetter. The lab scheduler calls Reschedule on its
// destruction queue whenever a lab moves, and that queue's timeGetter returns Lab.EndTime — which
// is exactly nil for a lab the user just made indefinite.
//
// Reschedule should mirror Schedule: drop the item from the queue and return.
func TestSchedule_RescheduleWithoutATimePanics(t *testing.T) {
	schedule := newSchedule()

	schedule.Schedule(&scheduleItem{Key: "a", Time: at(time.Hour)})

	assert.Panics(t, func() {
		schedule.Reschedule(&scheduleItem{Key: "a", Time: nil})
	}, "rescheduling an item with no time dereferences a nil pointer")
}

func TestSchedule_ScheduleWithoutATimeIsSafe(t *testing.T) {
	schedule := newSchedule()

	// The guard Reschedule is missing.
	assert.NotPanics(t, func() {
		schedule.Schedule(&scheduleItem{Key: "a", Time: nil})
	})

	assert.False(t, schedule.IsScheduled("a"))
}

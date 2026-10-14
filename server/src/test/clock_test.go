package test

import (
	"sync"
	"time"
)

// FakeClock is the scheduler's clock in tests. It only moves when a test moves it, so labs become due when a
// test says so instead of after real time has passed.
type FakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *FakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.now
}

// Advance moves the clock forward by the given duration.
func (c *FakeClock) Advance(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.now = c.now.Add(duration)
}

// WaitForSchedulerTicks waits until the scheduler has checked its queues the given number of times more, so
// everything that is due by then has been taken from them.
func (h *Harness) WaitForSchedulerTicks(count uint64) {
	h.T.Helper()

	target := h.Scheduler.Ticks() + count
	requireEventually(h.T, func() bool {
		return h.Scheduler.Ticks() >= target
	}, "the scheduler stopped checking its queues")
}

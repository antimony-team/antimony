package instance

import (
	"sync"
	"time"
)

type inspectDebouncer struct {
	mu     sync.Mutex
	timers map[string]*time.Timer
	delay  time.Duration
	fn     func(labId string)
}

func createInspectDebouncer(delay time.Duration, fn func(labId string)) *inspectDebouncer {
	return &inspectDebouncer{timers: map[string]*time.Timer{}, delay: delay, fn: fn}
}

// Trigger schedules fn for labId; repeated triggers within delay collapse into one call.
func (d *inspectDebouncer) Trigger(labId string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if t, ok := d.timers[labId]; ok {
		t.Stop()
	}

	d.timers[labId] = time.AfterFunc(d.delay, func() {
		d.mu.Lock()
		delete(d.timers, labId)
		d.mu.Unlock()
		d.fn(labId)
	})
}

package utils

import (
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEventBus_PublishWithoutSubscribersIsANoOp(t *testing.T) {
	bus := CreateEventBus[string]()

	assert.NotPanics(t, func() { bus.Publish("nobody-listening", "payload") })
}

func TestEventBus_DeliversToASubscriber(t *testing.T) {
	bus := CreateEventBus[string]()

	var received []string
	bus.Subscribe("topic", func(value string) { received = append(received, value) })

	bus.Publish("topic", "first")
	bus.Publish("topic", "second")

	assert.Equal(t, []string{"first", "second"}, received)
}

func TestEventBus_DeliversToEverySubscriberOfATopic(t *testing.T) {
	bus := CreateEventBus[int]()

	var first, second, third int

	bus.Subscribe("topic", func(value int) { first = value })
	bus.Subscribe("topic", func(value int) { second = value })
	bus.Subscribe("topic", func(value int) { third = value })

	bus.Publish("topic", 42)

	assert.Equal(t, 42, first)
	assert.Equal(t, 42, second)
	assert.Equal(t, 42, third)
}

func TestEventBus_TopicsAreIsolated(t *testing.T) {
	bus := CreateEventBus[string]()

	var onA, onB int

	bus.Subscribe("a", func(string) { onA++ })
	bus.Subscribe("b", func(string) { onB++ })

	bus.Publish("a", "x")
	bus.Publish("a", "y")
	bus.Publish("b", "z")

	assert.Equal(t, 2, onA)
	assert.Equal(t, 1, onB)
}

func TestEventBus_UnsubscribeStopsDelivery(t *testing.T) {
	bus := CreateEventBus[string]()

	var count int
	unsubscribe := bus.Subscribe("topic", func(string) { count++ })

	bus.Publish("topic", "before")
	unsubscribe()
	bus.Publish("topic", "after")

	assert.Equal(t, 1, count, "no delivery may happen after unsubscribing")
}

func TestEventBus_UnsubscribeOnlyAffectsItsOwnHandler(t *testing.T) {
	bus := CreateEventBus[string]()

	var kept, dropped int

	bus.Subscribe("topic", func(string) { kept++ })
	unsubscribe := bus.Subscribe("topic", func(string) { dropped++ })

	unsubscribe()
	bus.Publish("topic", "payload")

	assert.Equal(t, 1, kept)
	assert.Equal(t, 0, dropped)
}

func TestEventBus_UnsubscribeTwiceIsSafe(t *testing.T) {
	bus := CreateEventBus[string]()

	unsubscribe := bus.Subscribe("topic", func(string) {})

	unsubscribe()
	assert.NotPanics(t, unsubscribe)
}

func TestEventBus_PublishAfterEverySubscriberLeftIsANoOp(t *testing.T) {
	bus := CreateEventBus[string]()

	unsubscribe := bus.Subscribe("topic", func(string) {
		t.Error("a removed handler must never be invoked")
	})
	unsubscribe()

	assert.NotPanics(t, func() { bus.Publish("topic", "payload") })
}

func TestEventBus_DeliversPointerPayloadsByReference(t *testing.T) {
	type payload struct{ Name string }

	bus := CreateEventBus[*payload]()

	var got *payload
	bus.Subscribe("topic", func(value *payload) { got = value })

	sent := &payload{Name: "antimony"}
	bus.Publish("topic", sent)

	assert.Same(t, sent, got, "the bus must hand the subscriber the same pointer it was given")
}

func TestEventBus_ConcurrentPublishAndSubscribe(t *testing.T) {
	bus := CreateEventBus[int]()

	var delivered atomic.Int64
	bus.Subscribe("topic", func(int) { delivered.Add(1) })

	const goroutines = 8
	const perGoroutine = 50

	var waitGroup sync.WaitGroup

	// Publishers and subscribers churning at the same time, to be run under -race.
	for range goroutines {
		waitGroup.Add(2)

		go func() {
			defer waitGroup.Done()

			for i := range perGoroutine {
				bus.Publish("topic", i)
			}
		}()

		go func() {
			defer waitGroup.Done()

			for range perGoroutine {
				bus.Subscribe("churn", func(int) {})()
			}
		}()
	}

	waitGroup.Wait()

	assert.Equal(t, int64(goroutines*perGoroutine), delivered.Load())
}

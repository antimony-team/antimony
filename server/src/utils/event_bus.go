package utils

import "sync"

type (
	EventBus[T any] interface {
		Publish(topic string, value T)
		Subscribe(topic string, handler func(T)) func()
	}

	eventBus[T any] struct {
		mutex sync.RWMutex

		nextId uint64

		subscribers map[string]map[uint64]func(T)
	}
)

func CreateEventBus[T any]() EventBus[T] {
	return &eventBus[T]{
		mutex:       sync.RWMutex{},
		nextId:      0,
		subscribers: make(map[string]map[uint64]func(T), 0),
	}
}

func (b *eventBus[T]) Publish(topic string, value T) {
	b.mutex.RLock()
	defer b.mutex.RUnlock()

	if topic, ok := b.subscribers[topic]; ok {
		for _, fn := range topic {
			fn(value)
		}
	}
}

func (b *eventBus[T]) Subscribe(topic string, handler func(T)) func() {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.nextId++
	id := b.nextId
	if b.subscribers[topic] == nil {
		b.subscribers[topic] = make(map[uint64]func(T))
	}
	b.subscribers[topic][id] = handler

	return func() {
		b.mutex.Lock()
		defer b.mutex.Unlock()

		if m, ok := b.subscribers[topic]; ok {
			delete(m, id)
			if len(m) == 0 {
				delete(b.subscribers, topic)
			}
		}
	}
}

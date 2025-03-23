package events

import (
	"slices"
)

type (
	Event[T any] interface {
		Dispatch(value T)
		Subscribe(*func(value T))
		Unsubscribe(*func(value T))
	}

	event[T any] struct {
		listeners []*func(value T)
	}
)

func CreateEvent[T any]() Event[T] {
	return &event[T]{
		listeners: make([]*func(data T), 0),
	}
}

func (m event[T]) Dispatch(value T) {
	for _, listener := range m.listeners {
		(*listener)(value)
	}
}

func (m event[T]) Subscribe(f *func(data T)) {
	m.listeners = append(m.listeners, f)
}

func (m event[T]) Unsubscribe(f *func(data T)) {
	if index := slices.Index(m.listeners, f); index > -1 {
		m.listeners = append(m.listeners[:index], m.listeners[index+1:]...)
	}
}

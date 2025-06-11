package utils

import (
	"slices"
	"sort"
	"sync"
	"time"
)

type (
	Schedule[T any] interface {
		Schedule(item *T)
		Reschedule(item *T)
		IsScheduled(key string) bool

		Remove(key string)

		TryPop() *T
	}

	schedule[T any] struct {
		schedule    []*T
		scheduleMap map[string]*T

		mutex *sync.Mutex

		keyGetter  func(T) string
		timeGetter func(T) *time.Time
	}
)

func CreateSchedule[T any](keyGetter func(T) string, timeGetter func(T) *time.Time) Schedule[T] {
	schedule := &schedule[T]{
		schedule:    make([]*T, 0),
		scheduleMap: make(map[string]*T),
		mutex:       &sync.Mutex{},
		keyGetter:   keyGetter,
		timeGetter:  timeGetter,
	}

	return schedule
}

func (s *schedule[T]) Schedule(item *T) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	// Skip scheduling if the item's time is nil
	if s.timeGetter(*item) == nil {
		return
	}

	s.insert(s.keyGetter(*item), item)
}

func (s *schedule[T]) Reschedule(item *T) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if _, isScheduled := s.scheduleMap[s.keyGetter(*item)]; isScheduled {
		s.remove(s.keyGetter(*item))
	}

	s.insert(s.keyGetter(*item), item)
}

func (s *schedule[T]) IsScheduled(key string) bool {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	return s.has(key)
}

func (s *schedule[T]) Remove(key string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.remove(key)
}

func (s *schedule[T]) TryPop() *T {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if len(s.schedule) > 0 && s.timeGetter(*s.schedule[0]).Unix() <= time.Now().Unix() {
		item := s.schedule[0]

		s.schedule = s.schedule[1:]
		delete(s.scheduleMap, s.keyGetter(*item))

		return item
	}

	return nil
}

func (s *schedule[T]) has(key string) bool {
	_, ok := s.scheduleMap[key]

	return ok
}

func (s *schedule[T]) remove(key string) {

	if item, isScheduled := s.scheduleMap[key]; isScheduled {
		delete(s.scheduleMap, key)
		itemIndex := slices.Index(s.schedule, item)
		s.schedule = append(s.schedule[:itemIndex], s.schedule[itemIndex+1:]...)
	}
}

func (s *schedule[T]) insert(key string, item *T) {
	itemTime := s.timeGetter(*item).Unix()
	insertIndex := sort.Search(len(s.schedule), func(i int) bool {
		return s.timeGetter(*s.schedule[i]).Unix() >= itemTime
	})

	if insertIndex == len(s.schedule) {
		s.schedule = append(s.schedule, item)
		s.scheduleMap[key] = item
		return
	}

	s.schedule = append(s.schedule[:insertIndex+1], s.schedule[insertIndex:]...)
	s.schedule[insertIndex] = item
	s.scheduleMap[key] = item
}

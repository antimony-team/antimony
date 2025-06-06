package utils

import (
	"github.com/charmbracelet/log"
	"slices"
	"sort"
	"sync"
	"time"
)

type (
	Schedule[T any] interface {
		Schedule(value *T)
		Reschedule(key string)
		IsScheduled(key string) bool

		Remove(key string)

		TryPop() *T
	}

	schedule[T any] struct {
		schedule    []*T
		scheduleMap map[string]*T

		mutex *sync.Mutex

		keyGetter  func(T) string
		timeGetter func(T) time.Time
	}
)

func CreateSchedule[T any](keyGetter func(T) string, timeGetter func(T) time.Time) Schedule[T] {
	schedule := &schedule[T]{
		schedule:    make([]*T, 0),
		scheduleMap: make(map[string]*T),
		mutex:       &sync.Mutex{},
		keyGetter:   keyGetter,
		timeGetter:  timeGetter,
	}

	return schedule
}

func (s *schedule[T]) Schedule(value *T) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.insert(s.keyGetter(*value), value)
}

func (s *schedule[T]) Reschedule(key string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if item, isScheduled := s.scheduleMap[key]; isScheduled {
		s.remove(key)
		s.insert(key, item)
	}
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

	log.Infof("trypop, schedule: %v", s.schedule)

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

func (s *schedule[T]) insert(key string, value *T) {
	itemTime := s.timeGetter(*value).Unix()
	insertIndex := sort.Search(len(s.schedule), func(i int) bool {
		return s.timeGetter(*s.schedule[i]).Unix() >= itemTime
	})

	log.Infof("inserting into schedule: %v, index: %d", key, insertIndex)

	if insertIndex == len(s.schedule) {
		s.schedule = append(s.schedule, value)
		s.scheduleMap[key] = value
		return
	}

	s.schedule = append(s.schedule[:insertIndex+1], s.schedule[insertIndex:]...)
	s.schedule[insertIndex] = value
	s.scheduleMap[key] = value

	log.Infof("after insert %v", s.schedule)
}

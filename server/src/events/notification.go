package events

import (
	"antimonyBackend/utils/serverlog"
	"time"
)

type Notification struct {
	Content   string
	Timestamp time.Time
	Type      serverlog.LogLevel
}

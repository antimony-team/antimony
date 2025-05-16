package events

import (
	"antimonyBackend/types"
	"time"
)

type Notification struct {
	Content   string
	Timestamp time.Time
	Type      types.Severity
}

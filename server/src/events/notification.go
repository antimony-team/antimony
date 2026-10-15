package events

import (
	"time"

	"github.com/antimony-team/antimony-server/utils/serverlog"
)

type Notification struct {
	Content   string
	Timestamp time.Time
	Type      serverlog.LogLevel
}

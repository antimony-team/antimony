package events

import (
	"time"

	"github.com/antimony-team/antimony/server/src/utils/serverlog"
)

type Notification struct {
	Content   string
	Timestamp time.Time
	Type      serverlog.LogLevel
}

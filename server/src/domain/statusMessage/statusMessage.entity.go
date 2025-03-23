package statusMessage

import (
	"antimonyBackend/types"
	"time"
)

type StatusMessage struct {
	Content   string
	Timestamp time.Time
	Severity  types.Severity
	Receivers []string
}

type StatusMessageOut struct {
	Content   string         `json:"content"`
	Timestamp time.Time      `json:"timestamp"`
	Severity  types.Severity `json:"severity"`
}

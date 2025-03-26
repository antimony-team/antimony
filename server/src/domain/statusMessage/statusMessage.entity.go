package statusMessage

import (
	"antimonyBackend/types"
	"antimonyBackend/utils"
	"time"
)

type StatusMessage struct {
	ID        string         `json:"id"`
	Summary   string         `json:"summary"`
	Detail    string         `json:"detail"`
	Timestamp time.Time      `json:"timestamp"`
	Severity  types.Severity `json:"severity"`
}

func Success(summary string, detail string) StatusMessage {
	return newStatusMessage(summary, detail, types.Success)
}

func Info(summary string, detail string) StatusMessage {
	return newStatusMessage(summary, detail, types.Info)
}

func Warning(summary string, detail string) StatusMessage {
	return newStatusMessage(summary, detail, types.Warning)
}

func Error(summary string, detail string) StatusMessage {
	return newStatusMessage(summary, detail, types.Error)
}

func Fatal(summary string, detail string) StatusMessage {
	return newStatusMessage(summary, detail, types.Fatal)
}

func newStatusMessage(summary string, detail string, severity types.Severity) StatusMessage {
	return StatusMessage{
		ID:        utils.GenerateUuid(),
		Summary:   summary,
		Detail:    detail,
		Severity:  severity,
		Timestamp: time.Now(),
	}
}

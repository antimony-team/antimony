package statusMessage

import (
	"antimonyBackend/types"
	"antimonyBackend/utils"
	"time"
)

type StatusMessage struct {
	ID        string         `json:"id"`
	Source    string         `json:"source"`
	Content   string         `json:"content"`
	Timestamp time.Time      `json:"timestamp"`
	Severity  types.Severity `json:"severity"`
}

func Success(source string, content string) StatusMessage {
	return newStatusMessage(source, content, types.Success)
}

func Info(source string, content string) StatusMessage {
	return newStatusMessage(source, content, types.Info)
}

func Warning(source string, content string) StatusMessage {
	return newStatusMessage(source, content, types.Warning)
}

func Error(source string, content string) StatusMessage {
	return newStatusMessage(source, content, types.Error)
}

func Fatal(source string, content string) StatusMessage {
	return newStatusMessage(source, content, types.Fatal)
}

func newStatusMessage(source string, content string, severity types.Severity) StatusMessage {
	return StatusMessage{
		ID:        utils.GenerateUuid(),
		Source:    source,
		Content:   content,
		Severity:  severity,
		Timestamp: time.Now(),
	}
}

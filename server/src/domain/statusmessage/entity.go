package statusmessage

import (
	"antimonyBackend/types"
	"antimonyBackend/utils"
	"fmt"
	"time"
)

type Message struct {
	ID         string         `json:"id"`
	Source     string         `json:"source"`
	Content    string         `json:"content"`
	LogContent string         `json:"logContent"`
	Timestamp  time.Time      `json:"timestamp"`
	Severity   types.Severity `json:"severity"`
}

func Success(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, types.Success, logContent...)
}

func Info(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, types.Info, logContent...)
}

func Warning(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, types.Warning, logContent...)
}

func Error(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, types.Error, logContent...)
}

func Fatal(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, types.Fatal, logContent...)
}

func newMessage(source string, content string, severity types.Severity, logParts ...string) *Message {
	logContent := content
	if len(logParts) > 0 {
		logMessage := logParts[0] + " "
		for i := 1; i < len(logParts); i += 2 {
			if i+1 < len(logParts) {
				logMessage += fmt.Sprintf("%s=%s ", logParts[i], logParts[i+1])
			} else {
				logMessage += logParts[i]
			}
		}
		logContent = fmt.Sprintf("%s ANTIMONY %s", time.Now().Format(time.TimeOnly), logMessage)
	}

	return &Message{
		ID:         utils.GenerateUuid(),
		Source:     source,
		Content:    content,
		Severity:   severity,
		LogContent: logContent,
		Timestamp:  time.Now(),
	}
}

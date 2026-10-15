package statusmessage

import (
	"antimonyBackend/utils"
	"antimonyBackend/utils/serverlog"
	"time"
)

type Message struct {
	ID         string             `json:"id"`
	Source     string             `json:"source"`
	Content    string             `json:"content"`
	LogContent string             `json:"logContent"`
	Timestamp  time.Time          `json:"timestamp"`
	Severity   serverlog.LogLevel `json:"severity"`
}

func Success(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, serverlog.SuccessLevel, logContent...)
}

func Info(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, serverlog.InfoLevel, logContent...)
}

func Warning(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, serverlog.WarningLevel, logContent...)
}

func Error(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, serverlog.ErrorLevel, logContent...)
}

func Fatal(source string, content string, logContent ...string) *Message {
	return newMessage(source, content, serverlog.FatalLevel, logContent...)
}

func newMessage(source string, content string, severity serverlog.LogLevel, logParts ...string) *Message {
	logContent := content
	if len(logParts) > 0 {
		logContent = serverlog.CreateAntimonyLog(severity, logParts...)
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

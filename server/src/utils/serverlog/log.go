package serverlog

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*m`)

type LogEntry struct {
	Level   LogLevel
	Message string
	Time    time.Time
	Source  string
}

func (l LogEntry) String() string {
	return fmt.Sprintf("%s %s %s %s", l.Time.Format(time.TimeOnly), l.Level, l.Source, l.Message)
}

func ReplaceAnsiCharacters(data string) string {
	return ansiEscape.ReplaceAllString(data, "")
}

func CreateAntimonyLog(level LogLevel, messageParts ...string) string {
	return LogEntry{
		Level:   level,
		Message: formatMessage(messageParts),
		Time:    time.Now(),
		Source:  "SERV",
	}.String()
}

// CreateKubeLog creates a log entry for something reported by Kubernetes, such as an event, at the time it occurred.
func CreateKubeLog(level LogLevel, timestamp time.Time, messageParts ...string) string {
	return LogEntry{
		Level:   level,
		Message: formatMessage(messageParts),
		Time:    timestamp.Local(),
		Source:  "KUBE",
	}.String()
}

// formatMessage joins a message and its key-value pairs into "message key=value key=value".
func formatMessage(messageParts []string) string {
	logMessage := messageParts[0] + " "
	for i := 1; i < len(messageParts); i += 2 {
		if i+1 < len(messageParts) {
			logMessage += fmt.Sprintf("%s=%s ", messageParts[i], messageParts[i+1])
		} else {
			logMessage += messageParts[i]
		}
	}

	return logMessage
}

func CreateClabLog(line string) string {
	line = ansiEscape.ReplaceAllString(line, "")
	entry := &LogEntry{Level: InfoLevel, Message: line, Time: time.Now(), Source: "CLAB"}

	parts := strings.SplitN(line, " ", 3)
	if len(parts) < 3 {
		return entry.String()
	}

	ts, err := time.ParseInLocation("15:04:05", parts[0], time.Local)
	level, ok := clabLevels[parts[1]]
	if err != nil || !ok {
		return entry.String()
	}

	now := time.Now()
	entry.Time = time.Date(now.Year(), now.Month(), now.Day(), ts.Hour(), ts.Minute(), ts.Second(), 0, time.Local)
	entry.Level = level
	entry.Message = strings.TrimSpace(parts[2])

	return entry.String()
}

func FormatClabLog(onLog func(string)) func(string) {
	return func(message string) {
		if onLog == nil {
			return
		}

		log := CreateClabLog(message)
		if log != "" {
			onLog(log)
		}
	}
}

var clabLevels = map[string]LogLevel{
	"DEBU": InfoLevel,
	"INFO": InfoLevel,
	"WARN": WarningLevel,
	"ERRO": ErrorLevel,
	"FATA": FatalLevel,
}

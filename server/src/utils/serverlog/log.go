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

func CreateAntimonyLog(level LogLevel, messageParts ...string) string {
	logMessage := messageParts[0] + " "
	for i := 1; i < len(messageParts); i += 2 {
		if i+1 < len(messageParts) {
			logMessage += fmt.Sprintf("%s=%s ", messageParts[i], messageParts[i+1])
		} else {
			logMessage += messageParts[i]
		}
	}

	return LogEntry{
		Level:   level,
		Message: logMessage,
		Time:    time.Now(),
		Source:  "SERV",
	}.String()
}

func CreateKubeCtlLog(line string) string {
	if line == "" {
		return ""
	}

	header, msg, found := strings.Cut(line, "] ")
	fields := strings.Fields(header)

	// klog header: I0918 14:14:04.502476 229402 loader.go:407
	if !found || len(fields) != 4 || len(fields[0]) != 5 {
		return LogEntry{Level: InfoLevel, Message: line, Time: time.Now(), Source: "KUBE"}.String()
	}

	level := InfoLevel
	switch fields[0][0] {
	case 'W':
		level = WarningLevel
	case 'E', 'F':
		level = ErrorLevel
	}

	ts, err := time.ParseInLocation("2006 0102 15:04:05.000000",
		fmt.Sprintf("%d %s %s", time.Now().Year(), fields[0][1:], fields[1]), time.Local)
	if err != nil {
		ts = time.Now()
	}

	return LogEntry{Level: level, Message: msg, Time: ts, Source: "KUBE"}.String()
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

func FormatKubectlLog(onLog func(string)) func(string) {
	return func(message string) {
		log := CreateKubeCtlLog(message)
		if log != "" {
			onLog(log)
		}
	}
}

func FormatClabLog(onLog func(string)) func(string) {
	return func(message string) {
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

package serverlog

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * LogLevel
 */

func TestLogLevel_String(t *testing.T) {
	cases := map[LogLevel]string{
		SuccessLevel: "SUCCESS",
		InfoLevel:    "INFO",
		WarningLevel: "WARNING",
		ErrorLevel:   "ERROR",
		FatalLevel:   "FATAL",
	}

	for level, expected := range cases {
		assert.Equal(t, expected, level.String())
	}
}

func TestLogLevel_StringPanicsForAnUnknownLevel(t *testing.T) {
	// The String method indexes a fixed array, so an out-of-range level is a programming error
	// rather than an "UNKNOWN" fallback.
	assert.Panics(t, func() { _ = LogLevel(99).String() })
}

/*
 * ReplaceAnsiCharacters
 */

func TestReplaceAnsiCharacters(t *testing.T) {
	cases := map[string]struct {
		in  string
		out string
	}{
		"colour codes":     {"\x1b[31mred\x1b[0m", "red"},
		"bold":             {"\x1b[1mbold\x1b[22m", "bold"},
		"multiple codes":   {"\x1b[1m\x1b[31mboth\x1b[0m", "both"},
		"no escape codes":  {"plain text", "plain text"},
		"empty string":     {"", ""},
		"only escape code": {"\x1b[0m", ""},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, testCase.out, ReplaceAnsiCharacters(testCase.in))
		})
	}
}

/*
 * LogEntry
 */

func TestLogEntry_StringCarriesLevelSourceAndMessage(t *testing.T) {
	entry := LogEntry{Level: WarningLevel, Message: "something happened", Source: "TEST"}

	rendered := entry.String()

	assert.Contains(t, rendered, "WARNING")
	assert.Contains(t, rendered, "TEST")
	assert.Contains(t, rendered, "something happened")
}

/*
 * CreateAntimonyLog
 */

func TestCreateAntimonyLog_RendersKeyValuePairs(t *testing.T) {
	rendered := CreateAntimonyLog(InfoLevel, "deployment started", "lab", "abc", "node", "srl1")

	assert.Contains(t, rendered, "INFO")
	assert.Contains(t, rendered, "SERV")
	assert.Contains(t, rendered, "deployment started")
	assert.Contains(t, rendered, "lab=abc")
	assert.Contains(t, rendered, "node=srl1")
}

func TestCreateAntimonyLog_MessageOnly(t *testing.T) {
	rendered := CreateAntimonyLog(ErrorLevel, "just a message")

	assert.Contains(t, rendered, "ERROR")
	assert.Contains(t, rendered, "just a message")
}

func TestCreateAntimonyLog_AppendsADanglingKeyWithoutAValue(t *testing.T) {
	// An odd number of trailing parts means the last key has no value; it is appended bare rather
	// than rendered as "key=".
	rendered := CreateAntimonyLog(InfoLevel, "message", "key", "value", "dangling")

	assert.Contains(t, rendered, "key=value")
	assert.Contains(t, rendered, "dangling")
	assert.NotContains(t, rendered, "dangling=")
}

func TestCreateAntimonyLog_PanicsWithoutAnyMessageParts(t *testing.T) {
	// Indexing messageParts[0] unconditionally means a caller that passes no parts crashes. Not
	// reachable from statusmessage, which only calls this when it has at least one part, but worth
	// pinning so it is not made reachable by accident.
	assert.Panics(t, func() { CreateAntimonyLog(InfoLevel) })
}

/*
 * CreateClabLog
 */

func TestCreateClabLog_ParsesATimestampedLevelledLine(t *testing.T) {
	rendered := CreateClabLog("14:15:16 INFO Creating container: srl1")

	assert.Contains(t, rendered, "14:15:16", "the containerlab timestamp must be preserved")
	assert.Contains(t, rendered, "INFO")
	assert.Contains(t, rendered, "CLAB")
	assert.Contains(t, rendered, "Creating container: srl1")
}

func TestCreateClabLog_MapsContainerlabLevels(t *testing.T) {
	cases := map[string]string{
		"DEBU": "INFO", // containerlab debug is surfaced as info
		"INFO": "INFO",
		"WARN": "WARNING",
		"ERRO": "ERROR",
		"FATA": "FATAL",
	}

	for clabLevel, expected := range cases {
		t.Run(clabLevel, func(t *testing.T) {
			rendered := CreateClabLog("14:15:16 " + clabLevel + " a message")

			assert.Contains(t, rendered, expected)
			assert.Contains(t, rendered, "a message")
		})
	}
}

func TestCreateClabLog_StripsAnsiCodes(t *testing.T) {
	rendered := CreateClabLog("14:15:16 \x1b[31mERRO\x1b[0m something failed")

	assert.NotContains(t, rendered, "\x1b")
	assert.Contains(t, rendered, "ERROR")
}

func TestCreateClabLog_FallsBackForUnrecognisedLines(t *testing.T) {
	cases := map[string]string{
		"too few fields":    "short line",
		"unknown level":     "14:15:16 NOPE a message",
		"bad timestamp":     "not-a-time INFO a message",
		"single word":       "word",
		"empty":             "",
		"no level at all":   "14:15:16 a message without a level",
		"trailing newlines": "14:15:16\n",
	}

	for name, line := range cases {
		t.Run(name, func(t *testing.T) {
			rendered := CreateClabLog(line)

			assert.Contains(t, rendered, "CLAB")
			assert.Contains(t, rendered, "INFO", "unparsed lines default to info")
		})
	}
}

func TestCreateClabLog_TrimsTheMessage(t *testing.T) {
	rendered := CreateClabLog("14:15:16 INFO    padded message   ")

	assert.Contains(t, rendered, "padded message")
	assert.NotContains(t, rendered, "padded message   ")
}

/*
 * CreateKubeLog
 */

func TestCreateKubeLog_UsesTheGivenTimeAndKubeSource(t *testing.T) {
	timestamp := time.Date(2026, 10, 1, 14, 15, 16, 0, time.Local)

	rendered := CreateKubeLog(WarningLevel, timestamp, "Pulling image", "node", "srl")

	assert.Contains(t, rendered, "14:15:16", "the event's own timestamp must be used")
	assert.Contains(t, rendered, "WARNING")
	assert.Contains(t, rendered, "KUBE")
	assert.Contains(t, rendered, "Pulling image node=srl")
}

/*
 * FormatClabLog
 */

func TestFormatClabLog_ForwardsFormattedLines(t *testing.T) {
	var received []string
	formatter := FormatClabLog(func(line string) { received = append(received, line) })

	formatter("14:15:16 WARN disk is filling up")

	require.Len(t, received, 1)
	assert.Contains(t, received[0], "WARNING")
	assert.Contains(t, received[0], "disk is filling up")
}

func TestFormatClabLog_ToleratesANilCallback(t *testing.T) {
	formatter := FormatClabLog(nil)

	assert.NotPanics(t, func() { formatter("14:15:16 INFO ignored") })
}

func TestFormatClabLog_ProducesSingleLineOutput(t *testing.T) {
	// The formatted output is streamed to socket clients one message per line, so an embedded
	// newline would split a single log entry across two messages.
	var clabLine string

	FormatClabLog(func(line string) { clabLine = line })("14:15:16 INFO no newlines please")

	assert.NotContains(t, clabLine, "\n")
}

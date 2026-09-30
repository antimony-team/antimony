package statusmessage

import (
	"antimonyBackend/utils/serverlog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConstructors_SetTheMatchingSeverity(t *testing.T) {
	cases := []struct {
		name     string
		build    func(string, string, ...string) *Message
		severity serverlog.LogLevel
	}{
		{"Success", Success, serverlog.SuccessLevel},
		{"Info", Info, serverlog.InfoLevel},
		{"Warning", Warning, serverlog.WarningLevel},
		{"Error", Error, serverlog.ErrorLevel},
		{"Fatal", Fatal, serverlog.FatalLevel},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			message := testCase.build("Runtime", "something happened")

			require.NotNil(t, message)
			assert.Equal(t, testCase.severity, message.Severity)
			assert.Equal(t, "Runtime", message.Source)
			assert.Equal(t, "something happened", message.Content)
		})
	}
}

func TestMessage_LogContentMirrorsContentWhenNoLogPartsAreGiven(t *testing.T) {
	message := Info("Runtime", "deploying lab")

	assert.Equal(t, "deploying lab", message.LogContent,
		"without log parts the client-facing content is reused verbatim")
}

func TestMessage_LogContentIsFormattedWhenLogPartsAreGiven(t *testing.T) {
	message := Info(
		"Runtime", "Deploying lab 'demo'",
		"Starting deployment of lab", "name", "demo", "id", "lab-1",
	)

	assert.Equal(t, "Deploying lab 'demo'", message.Content, "the user-facing content is untouched")

	assert.Contains(t, message.LogContent, "Starting deployment of lab")
	assert.Contains(t, message.LogContent, "name=demo")
	assert.Contains(t, message.LogContent, "id=lab-1")
	assert.Contains(t, message.LogContent, "INFO")
	assert.Contains(t, message.LogContent, "SERV")
}

func TestMessage_LogContentCarriesTheSeverity(t *testing.T) {
	cases := map[string]struct {
		build    func(string, string, ...string) *Message
		expected string
	}{
		"success": {Success, "SUCCESS"},
		"warning": {Warning, "WARNING"},
		"error":   {Error, "ERROR"},
		"fatal":   {Fatal, "FATAL"},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			message := testCase.build("Runtime", "content", "log line", "key", "value")

			assert.Contains(t, message.LogContent, testCase.expected)
		})
	}
}

func TestMessage_GetsAUniqueId(t *testing.T) {
	seen := make(map[string]struct{})

	for range 50 {
		message := Info("Runtime", "content")

		require.NotEmpty(t, message.ID)

		_, duplicate := seen[message.ID]
		require.False(t, duplicate, "message IDs must be unique: %s", message.ID)

		seen[message.ID] = struct{}{}
	}
}

func TestMessage_IsTimestamped(t *testing.T) {
	before := time.Now()
	message := Info("Runtime", "content")
	after := time.Now()

	assert.False(t, message.Timestamp.Before(before))
	assert.False(t, message.Timestamp.After(after))
}

func TestMessage_AcceptsAnEmptyContent(t *testing.T) {
	message := Info("Runtime", "")

	assert.Empty(t, message.Content)
	assert.Empty(t, message.LogContent)
	assert.NotEmpty(t, message.ID, "an empty message still gets an identity")
}

func TestMessage_HandlesADanglingLogKey(t *testing.T) {
	message := Warning("Runtime", "content", "log line", "key", "value", "dangling")

	assert.Contains(t, message.LogContent, "key=value")
	assert.Contains(t, message.LogContent, "dangling")
}

package deployment

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * streamOutput and runCommandSync
 */

func TestStreamOutput_PassesEveryLineWithoutItsLineBreak(t *testing.T) {
	logs := &logCollector{}

	streamOutput(strings.NewReader("first\nsecond\r\n\nlast without a line break"), logs.log)

	assert.Equal(t, []string{"first", "second", "", "last without a line break"}, logs.all())
}

func TestStreamOutput_PassesOnALongLineInPartsAndKeepsGoing(t *testing.T) {
	long := strings.Repeat("x", 3*maxLogLineLength+100)
	logs := &logCollector{}

	streamOutput(strings.NewReader(long+"\nafter the long line\n"), logs.log)

	lines := logs.all()
	require.Len(t, lines, 5)
	assert.Equal(t, long, strings.Join(lines[:4], ""), "the parts make up the whole line")
	for _, part := range lines[:4] {
		assert.LessOrEqual(t, len(part), maxLogLineLength)
	}
	assert.Equal(t, "after the long line", lines[4], "the lines after a long one still arrive")
}

// failingReader returns its data, then an error, then more data that only draining reads.
type failingReader struct {
	rest   io.Reader
	failed bool
}

func (r *failingReader) Read(p []byte) (int, error) {
	if !r.failed {
		r.failed = true
		return copy(p, "line\n"), errors.New("read failed")
	}
	return r.rest.Read(p)
}

func TestStreamOutput_DrainsThePipeWhenReadingFails(t *testing.T) {
	rest := strings.NewReader(strings.Repeat("unread\n", 1000))
	reader := &failingReader{rest: rest}
	logs := &logCollector{}

	streamOutput(reader, logs.log)

	assert.Equal(t, []string{"line"}, logs.all())
	assert.Zero(t, rest.Len(), "whatever follows the failure is consumed, so a writer never blocks")
}

func TestRunCommandSync_FinishesWhenTheCommandWritesALongStderrLine(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// More than the scanner's 64 KiB line limit and the OS pipe buffer, on one line
	cmd := exec.CommandContext(ctx, "sh", "-c", `head -c 200000 /dev/zero | tr '\0' x >&2; echo done`)
	var stderr strings.Builder

	output, err := runCommandSync(cmd, func(line string) { stderr.WriteString(line) })

	require.NoError(t, err)
	require.NoError(t, ctx.Err(), "the command didn't finish")
	assert.Equal(t, "done\n", *output)
	assert.Equal(t, 200000, stderr.Len())
}

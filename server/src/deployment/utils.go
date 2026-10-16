package deployment

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/log"
)

func runCommandSync(cmd *exec.Cmd, onStderr func(string)) (*string, error) {
	var outputBuffer bytes.Buffer
	cmd.Stdout = &outputBuffer

	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Errorf("stderr pipe error: %v", err)
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		streamOutput(stderr, onStderr)
	}()

	// Wait closes the pipe, so all of stderr has to be read first.
	<-done

	err = cmd.Wait()
	output := outputBuffer.String()

	if err != nil {
		err = fmt.Errorf("sub-process '%s' failed: %w", cmd.String(), err)
	}

	return &output, err
}

// maxLogLineLength bounds a line handed to a log function. Longer lines are passed on in parts of this length.
const maxLogLineLength = 64 * 1024

// streamOutput passes every line of pipe to onLog, without its line break, until the pipe ends. It reads lines of
// any length, and drains the pipe if reading fails, so a process writing into it never blocks.
func streamOutput(pipe io.Reader, onLog func(data string)) {
	reader := bufio.NewReaderSize(pipe, maxLogLineLength)

	for {
		// A line longer than the buffer comes in parts, each of them ending with bufio.ErrBufferFull
		line, err := reader.ReadSlice('\n')

		if len(line) > 0 && onLog != nil {
			text := strings.TrimSuffix(string(line), "\n")
			onLog(strings.TrimSuffix(text, "\r"))
		}

		switch {
		case err == nil, errors.Is(err, bufio.ErrBufferFull):
			continue
		case !errors.Is(err, io.EOF):
			_, _ = io.Copy(io.Discard, pipe)
		}

		return
	}
}

func readFileOrEmpty(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// interactiveStartTimeout bounds how long opening an interactive session waits for the command to print its first
// output. A shell prints its prompt right away, a command that prints nothing is handed out after this.
const interactiveStartTimeout = time.Second

// startedReader reads an interactive session's output. Its first read starts right away, to tell whether the command
// started before the session is handed out, and its result is delivered to the first Read.
type startedReader struct {
	reader io.Reader

	// started is closed once the first read returned, first and firstErr hold its result
	started  chan struct{}
	first    []byte
	firstErr error
	consumed bool
}

func newStartedReader(reader io.Reader) *startedReader {
	output := &startedReader{reader: reader, started: make(chan struct{})}
	go output.readFirst()

	return output
}

// waitForStart waits until the command printed something, its output ended, timeout passed or ctx ended. It reports
// whether the output ended without anything printed, and the error it ended with unless that was a clean EOF. It must
// not run concurrently with Read.
func (r *startedReader) waitForStart(ctx context.Context, timeout time.Duration) (bool, error) {
	select {
	case <-r.started:
		if len(r.first) > 0 {
			return false, nil
		}
		if r.firstErr == nil || errors.Is(r.firstErr, io.EOF) {
			return true, nil
		}
		return true, r.firstErr
	case <-time.After(timeout):
		// The command started without printing anything, or it is still starting
		return false, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

// readFirst does the first read of the output and stores its result for the first Read.
func (r *startedReader) readFirst() {
	buffer := make([]byte, 4096)
	n, err := r.reader.Read(buffer)

	r.first = buffer[:n]
	r.firstErr = err
	close(r.started)
}

func (r *startedReader) Read(p []byte) (int, error) {
	if !r.consumed {
		<-r.started

		if len(r.first) > 0 {
			n := copy(p, r.first)
			r.first = r.first[n:]
			return n, nil
		}

		r.consumed = true
		if r.firstErr != nil {
			return 0, r.firstErr
		}
	}

	return r.reader.Read(p)
}

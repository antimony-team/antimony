package deployment

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

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

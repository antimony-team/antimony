package deployment

import (
	"bufio"
	"bytes"
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

	go streamOutput(stderr, onStderr)

	err = cmd.Wait()
	output := outputBuffer.String()

	if err != nil {
		err = fmt.Errorf("sub-process '%s' failed: %s", cmd.String(), err)
	}

	return &output, err
}

func streamOutput(pipe io.Reader, onLog func(data string)) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		if onLog != nil {
			onLog(scanner.Text())
		}
	}
	if err := scanner.Err(); err != nil {
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

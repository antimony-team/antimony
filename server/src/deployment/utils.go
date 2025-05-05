package deployment

import (
	"bufio"
	"bytes"
	"github.com/charmbracelet/log"
	"io"
	"os/exec"
)

func runClabCommandSync(cmd *exec.Cmd, onLog func(string)) (*string, error) {
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

	go streamOutput(stderr, onLog)

	err = cmd.Wait()
	output := outputBuffer.String()
	return &output, err
}

func runClabCommand(cmd *exec.Cmd, onLog func(string), onDone func(*string, error)) {
	var outputBuffer bytes.Buffer
	cmd.Stdout = &outputBuffer

	stderr, err := cmd.StderrPipe()
	if err != nil {
		onDone(nil, err)
		return
	}

	if err := cmd.Start(); err != nil {
		onDone(nil, err)
		return
	}

	go streamOutput(stderr, onLog)

	err = cmd.Wait()
	output := outputBuffer.String()
	onDone(&output, err)
}

func streamOutput(pipe io.Reader, onLog func(data string)) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		if onLog != nil {
			onLog(scanner.Text())
		}
	}
	if err := scanner.Err(); err != nil {
	}
}

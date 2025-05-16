package deployment

import (
	"bufio"
	"bytes"
	"github.com/charmbracelet/log"
	"io"
	"os/exec"
)

func runClabCommand(cmd *exec.Cmd, onLog func(data string), onDone func(output *string, err error)) {
	var outputBuffer bytes.Buffer
	cmd.Stdout = &outputBuffer

	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Errorf("Failed to read stderr from clab subprocess: %s", err.Error())
		onDone(nil, err)
		return
	}

	if err := cmd.Start(); err != nil {
		onDone(nil, err)
		return
	}

	go streamOutput(stderr, onLog)

	err = cmd.Wait()
	outputData := outputBuffer.String()

	onDone(&outputData, err)
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

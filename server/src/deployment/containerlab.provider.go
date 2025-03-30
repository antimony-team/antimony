package deployment

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"github.com/charmbracelet/log"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"io"
	"os/exec"
)

type ContainerlabProvider struct{}

func (p *ContainerlabProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile, "--reconfigure")
	runClabCommand(cmd, onLog, onDone)
}

func (p *ContainerlabProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "redeploy", "-t", topologyFile)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ContainerlabProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)
	runClabCommand(cmd, onLog, onDone)
}
func (p *ContainerlabProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *InspectOutput, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "-t", topologyFile, "--format", "json")
	runClabCommand(cmd, onLog, func(output *string, err error) {
		if err != nil {
			onDone(nil, err)
			return
		}
		
		var inspectOutput InspectOutput
		err = json.Unmarshal([]byte(*output), &inspectOutput)
		onDone(&inspectOutput, err)
	})
}

func (p *ContainerlabProvider) Exec(
	ctx context.Context,
	topologyFile string,
	content string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "exec", "-t", topologyFile, "--cmd", content)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ContainerlabProvider) ExecOnNode(
	ctx context.Context,
	topologyFile string,
	content string,
	nodeLabel string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "exec", "-t", topologyFile, "--cmd", content, "--label", nodeLabel)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ContainerlabProvider) Save(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "save", "-t", topologyFile)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ContainerlabProvider) SaveOnNode(
	ctx context.Context,
	topologyFile string,
	nodeName string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "save", "-t", topologyFile, "--label", nodeName)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ContainerlabProvider) StreamContainerLogs(
	ctx context.Context,
	containerID string,
	onLog func(data string),
) error {
	cli, err := client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		return err
	}
	logOptions := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Timestamps: false,
		Tail:       "all",
	}

	out, err := cli.ContainerLogs(ctx, containerID, logOptions)
	if err != nil {
		return err
	}

	go streamOutput(out, onLog)
	return nil
}

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
		onLog(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
	}
}

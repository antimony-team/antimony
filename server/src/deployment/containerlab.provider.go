package deployment

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"os/exec"
)

type ContainerlabProvider struct{}

func (p *ContainerlabProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile, "--log-level", "debug")
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

		if *output == "" {
			onDone(&InspectOutput{
				Containers: []InspectContainer{},
			}, nil)
		}

		var inspectOutput InspectOutput
		err = json.Unmarshal([]byte(*output), &inspectOutput)
		onDone(&inspectOutput, err)
	})
}

func (p *ContainerlabProvider) InspectAll(
	ctx context.Context,
) (*InspectOutput, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "--all", "--format", "json")
	if output, err := runClabCommandSync(cmd); err != nil {
		return nil, err
	} else {
		if *output == "" {
			return &InspectOutput{
				Containers: []InspectContainer{},
			}, nil
		}

		var inspectOutput InspectOutput
		err = json.Unmarshal([]byte(*output), &inspectOutput)
		return &inspectOutput, err
	}
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
	_ string,
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

func runClabCommandSync(cmd *exec.Cmd) (*string, error) {
	var outputBuffer bytes.Buffer
	cmd.Stdout = &outputBuffer

	err := cmd.Run()
	outputData := outputBuffer.String()
	return &outputData, err
}

package deployment

import (
	"context"
	"encoding/json"
	"io"
	"os/exec"
	"time"

	"github.com/charmbracelet/log"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
)

type ContainerlabProvider struct{}

func (p *ContainerlabProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) (*string, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile)
	return runClabCommandSync(cmd, onLog)
}

func (p *ContainerlabProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) (*string, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "redeploy", "-t", topologyFile)
	return runClabCommandSync(cmd, onLog)
}

func (p *ContainerlabProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) (*string, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)
	return runClabCommandSync(cmd, onLog)
}

func (p *ContainerlabProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) (InspectOutput, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "-t", topologyFile, "--format", "json")
	rawOutput, err := runClabCommandSync(cmd, onLog)

	if err != nil {
		return nil, err
	}

	if *rawOutput == "" {
		return InspectOutput{}, nil
	}

	var inspectOutput InspectOutput
	err = json.Unmarshal([]byte(*rawOutput), &inspectOutput)
	return inspectOutput, err
}

func (p *ContainerlabProvider) InspectAll(
	ctx context.Context,
) (InspectOutput, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "--all", "--format", "json")
	if output, err := runClabCommandSync(cmd, nil); err != nil {
		return nil, err
	} else {
		if *output == "" {
			return InspectOutput{}, nil
		}

		var inspectOutput InspectOutput
		err = json.Unmarshal([]byte(*output), &inspectOutput)

		return inspectOutput, err
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

func (p *ContainerlabProvider) OpenShell(
	ctx context.Context,
	containerId string,
) (io.ReadWriteCloser, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		return nil, err
	}

	execConfig := container.ExecOptions{
		Cmd:          []string{"/bin/bash"},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
	}

	containerExec, err := cli.ContainerExecCreate(ctx, containerId, execConfig)
	if err != nil {
		return nil, err
	}

	hr, err := cli.ContainerExecAttach(ctx, containerExec.ID, container.ExecAttachOptions{Tty: true})
	if err != nil {
		return nil, err
	}

	return hr.Conn, nil
}

func (p *ContainerlabProvider) StartNode(ctx context.Context, containerId string) error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return err
	}

	if err := cli.ContainerStart(ctx, containerId, container.StartOptions{}); err != nil {
		return err
	}

	return nil
}

func (p *ContainerlabProvider) StopNode(ctx context.Context, containerId string) error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return err
	}

	timeout := int(10 * time.Second)
	if err := cli.ContainerStop(ctx, containerId, container.StopOptions{Timeout: &timeout}); err != nil {
		return err
	}

	return nil
}

func (p *ContainerlabProvider) RestartNode(ctx context.Context, containerId string) error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return err
	}

	timeout := int(10 * time.Second)
	if err := cli.ContainerRestart(ctx, containerId, container.StopOptions{Timeout: &timeout}); err != nil {
		return err
	}

	return nil
}

func (p *ContainerlabProvider) RegisterListener(ctx context.Context, onUpdate func(containerId string)) error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return err
	}

	eventFilter := filters.NewArgs()
	eventFilter.Add("type", "container")

	channel, errs := cli.Events(ctx, events.ListOptions{
		Filters: eventFilter,
	})

	for {
		select {
		case msg := <-channel:
			onUpdate(msg.Actor.ID[:12])
		case err := <-errs:
			if err != nil {
				log.Errorf("Failed to receive docker events: %s", err.Error())
				return err
			}
		}
	}
}

func (p *ContainerlabProvider) StreamContainerLogs(
	ctx context.Context,
	_ string,
	containerId string,
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

	out, err := cli.ContainerLogs(ctx, containerId, logOptions)
	if err != nil {
		return err
	}

	go streamOutput(out, onLog)
	return nil
}

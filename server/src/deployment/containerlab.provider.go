package deployment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
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

func (p *ContainerlabProvider) ExecInteractive(
	ctx context.Context,
	containerId string,
	cmd []string,
) (io.ReadWriteCloser, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	defer closeDockerClient(cli)

	execConfig := container.ExecOptions{
		Cmd:          cmd,
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

	time.Sleep(20 * time.Millisecond)

	inspect, err := cli.ContainerExecInspect(ctx, containerExec.ID)
	if err != nil {
		hr.Close()
		return nil, err
	}

	if !inspect.Running && inspect.ExitCode != 0 {
		hr.Close()
		return nil, fmt.Errorf(
			"command %v failed to start (exit code %d): command not found or not executable",
			cmd,
			inspect.ExitCode,
		)
	}

	return hr.Conn, nil
}

func (p *ContainerlabProvider) StartNode(ctx context.Context, containerId string) error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return err
	}
	defer closeDockerClient(cli)

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
	defer closeDockerClient(cli)

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
	defer closeDockerClient(cli)

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
	defer closeDockerClient(cli)

	eventFilter := filters.NewArgs()
	eventFilter.Add("type", "container")
	eventFilter.Add("event", "start")
	eventFilter.Add("event", "stop")
	eventFilter.Add("event", "die")
	eventFilter.Add("event", "destroy")
	eventFilter.Add("event", "create")

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
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return err
	}
	defer closeDockerClient(cli)

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

func (p *ContainerlabProvider) GetInterfaces(
	ctx context.Context,
	containerId string,
) ([]string, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	defer closeDockerClient(cli)

	// Inspect the container
	info, err := cli.ContainerInspect(ctx, containerId)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container %q: %w", containerId, err)
	}

	// Execute `ip -j link show` inside the container to get all interfaces
	execConfig := container.ExecOptions{
		Cmd:          []string{"ls", "/sys/class/net"},
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := cli.ContainerExecCreate(ctx, info.ID, execConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create exec: %w", err)
	}

	hr, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to attach exec: %w", err)
	}
	defer hr.Close()

	var buf bytes.Buffer
	if _, err := stdcopy.StdCopy(&buf, &buf, hr.Reader); err != nil {
		return nil, err
	}

	var interfaces []string
	for _, iface := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		iface = strings.TrimSpace(iface)
		if iface != "" {
			interfaces = append(interfaces, iface)
		}
	}

	return interfaces, nil
}

func closeDockerClient(client *client.Client) {
	_ = client.Close()
}

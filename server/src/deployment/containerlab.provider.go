package deployment

import (
	"bufio"
	"context"
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
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile, "--reconfigure")
	return runClabCommand(cmd, "Deploy", onLog, nil)
}

func (p *ContainerlabProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "redeploy", "-t", topologyFile)
	return runClabCommand(cmd, "Redeploy", onLog, nil)
}

func (p *ContainerlabProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)
	return runClabCommand(cmd, "Destroy", onLog, nil)
}
func (p *ContainerlabProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onData func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "-t", topologyFile, "--format", "json")
	return runClabCommand(cmd, "Inspect", onLog, onData)
}

func (p *ContainerlabProvider) Exec(
	ctx context.Context,
	topologyFile string,
	content string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "exec", "-t", topologyFile, "--cmd", content)
	return runClabCommand(cmd, "Exec", onLog, nil)
}

func (p *ContainerlabProvider) ExecOnNode(
	ctx context.Context,
	topologyFile string,
	content string,
	nodeLabel string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "exec", "-t", topologyFile, "--cmd", content, "--label", nodeLabel)
	return runClabCommand(cmd, "ExecOnNode", onLog, nil)
}

func (p *ContainerlabProvider) Save(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "save", "-t", topologyFile)
	return runClabCommand(cmd, "Save", onLog, nil)
}

func (p *ContainerlabProvider) SaveOnNode(
	ctx context.Context,
	topologyFile string,
	nodeName string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "save", "-t", topologyFile, "--label", nodeName)
	return runClabCommand(cmd, "SaveOnNode", onLog, nil)
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

	go readOutput(out, onLog)
	return nil
}

func runClabCommand(cmd *exec.Cmd, operationName string, onLog func(data string), onData func(data string)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Errorf("Failed to read stdout from clab subprocess: %s", err.Error())
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Errorf("Failed to read stderr from clab subprocess: %s", err.Error())
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	go readOutput(stdout, onData)
	go readOutput(stderr, onLog)

	return cmd.Wait()
}

func readOutput(pipe io.Reader, onLog func(data string)) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		onLog(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
	}
}

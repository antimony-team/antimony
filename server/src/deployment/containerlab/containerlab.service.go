package containerlab

import (
	"bufio"
	"context"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"io"
	"os/exec"
)

type (
	DeploymentProvider interface {
		Deploy(ctx context.Context, topologyFile string, onLog func(data string)) error
		Destroy(ctx context.Context, topologyFile string, onLog func(data string)) error
		Inspect(ctx context.Context, topologyFile string, onLog func(data string)) error
		Redeploy(ctx context.Context, topologyFile string, onLog func(data string)) error
		Exec(ctx context.Context, topologyFile string, content string, onLog func(data string)) error
		ExecOnNode(ctx context.Context, topologyFile string, content string, nodeName string, onLog func(data string)) error
		Save(ctx context.Context, topologyFile string, onLog func(data string)) error
		SaveOnNode(ctx context.Context, topologyFile string, nodeName string, onLog func(data string)) error
		StreamContainerLogs(ctx context.Context, topologyFile string, onLog func(data string)) error
	}
)

type Service struct{}

func (s *Service) Deploy(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile, "--reconfigure")
	return runClabCommand(cmd, "Deploy", onLog)
}

// Server Restart uses Redeploy
func (s *Service) Redeploy(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "redeploy", "-t", topologyFile)
	return runClabCommand(cmd, "Redeploy", onLog)
}

func (s *Service) Destroy(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)
	return runClabCommand(cmd, "Destroy", onLog)
}
func (s *Service) Inspect(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "-t", topologyFile)
	return runClabCommand(cmd, "Inspect", onLog)
}

func (s *Service) Exec(ctx context.Context, topologyFile string, content string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "exec", "-t", topologyFile, "--cmd", content)
	return runClabCommand(cmd, "Exec", onLog)
}

func (s *Service) ExecOnNode(ctx context.Context, topologyFile string, content string, nodeLabel string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "exec", "-t", topologyFile, "--cmd", content, "--label", nodeLabel)
	return runClabCommand(cmd, "ExecOnNode", onLog)
}

func (s *Service) Save(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "save", "-t", topologyFile)
	return runClabCommand(cmd, "Save", onLog)
}

func (s *Service) SaveOnNode(ctx context.Context, topologyFile string, nodeName string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "save", "-t", topologyFile, "--label", nodeName)
	return runClabCommand(cmd, "SaveOnNode", onLog)
}

func (s *Service) StreamContainerLogs(ctx context.Context, containerID string, onLog func(data string)) error {
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

func runClabCommand(cmd *exec.Cmd, operationName string, onLog func(data string)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	go readOutput(stdout, func(data string) {
		onLog(data)
	})

	go readOutput(stderr, func(data string) {
		onLog(data)
	})

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

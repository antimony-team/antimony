package containerlab

import (
	"bufio"
	"context"
	"github.com/charmbracelet/log"
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
		streamContainerLogs(ctx context.Context, topologyFile string, onLog func(data string)) error
	}
)

type Service struct{}

func (s *Service) Deploy(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile, "--reconfigure")
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
		log.Infof("[CLAB] Deploy output: %s", data)
	})
	go readOutput(stderr, onLog)

	if err := cmd.Wait(); err != nil {
		return err
	}
	return nil
}

func (s *Service) Destroy(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	go readOutput(stderr, onLog)

	if err := cmd.Wait(); err != nil {
		return err
	}
	return nil
}
func (s *Service) Inspect(ctx context.Context, topologyFile string, onLog func(data string)) error {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "-t", topologyFile)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go readOutput(stderr, onLog)

	if err := cmd.Wait(); err != nil {
		return err
	}
	return nil
}

func (s *Service) streamContainerLogs(ctx context.Context, containerID string, onLog func(data string)) error {
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
func readOutput(pipe io.Reader, onLog func(data string)) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		onLog(scanner.Text())
		//log.Infof("[%s] %s\n", pipeName, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
	}
}

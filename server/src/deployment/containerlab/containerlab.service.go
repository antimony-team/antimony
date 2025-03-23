package containerlab

import (
	"bufio"
	"context"
	"github.com/charmbracelet/log"
	"io"
	"os/exec"
)

type DeploymentProvider interface {
	Deploy(ctx context.Context, topologyFile string) error
	Destroy(ctx context.Context, topologyFile string) error
}

type Service struct{}

func (s *Service) Deploy(ctx context.Context, topologyFile string) error {
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

	go readOutput(stdout, "stdout")
	go readOutput(stderr, "stderr")

	if err := cmd.Wait(); err != nil {
		return err
	}
	return nil
}

func (s *Service) Destroy(ctx context.Context, topologyFile string) error {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go readOutput(stderr, "stderr")

	if err := cmd.Wait(); err != nil {
		return err
	}
	return nil
}
func readOutput(pipe io.Reader, pipeName string) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		log.Infof("[%s] %s\n", pipeName, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
	}
}

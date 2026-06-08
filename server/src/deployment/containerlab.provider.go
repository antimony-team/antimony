package deployment

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/charmbracelet/log"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
)

type ContainerlabProvider struct {
	containerStatsCache map[string]*NodeStats
}

func CreateContainerlabProvider() *ContainerlabProvider {
	return &ContainerlabProvider{
		containerStatsCache: make(map[string]*NodeStats),
	}
}

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

func (p *ContainerlabProvider) RegisterEventListener(
	ctx context.Context,
	onUpdate func(containerlabEvent ContainerlabEvent),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "events", "--format", "json", "--interface-stats")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}

	if err = cmd.Start(); err != nil {
		return err
	}

	log.Infof("[EVENTS] Starting event listener")

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var output ContainerlabEvent
		rawOutput := scanner.Text()
		err := json.Unmarshal([]byte(rawOutput), &output)
		if err != nil {
			log.Errorf("[EVENTS] Failed to parse event: %s", err.Error())
		} else {
			onUpdate(output)
		}
	}

	return nil
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
) ([]NodeInterface, error) {
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

	if info.State == nil || info.State.Pid == 0 {
		return make([]NodeInterface, 0), fmt.Errorf("container %s has no PID (not running?)", containerId)
	}

	containerPid := info.State.Pid
	base := fmt.Sprintf("/proc/%d/root/sys/class/net", containerPid)
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", base, err)
	}

	var result []NodeInterface
	for _, e := range entries {
		name := e.Name()
		if name == "lo" {
			continue
		}
		dir := filepath.Join(base, name)

		mtu, _ := strconv.Atoi(readFileOrEmpty(filepath.Join(dir, "mtu")))
		result = append(result, NodeInterface{
			Name:    name,
			Address: readFileOrEmpty(filepath.Join(dir, "address")),
			MTU:     mtu,
			State:   readFileOrEmpty(filepath.Join(dir, "operstate")),
		})
	}

	return result, nil
}

func (p *ContainerlabProvider) ReadNodeStats(ctx context.Context, containerId string) (*NodeStats, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	defer closeDockerClient(cli)

	resp, err := cli.ContainerStatsOneShot(ctx, containerId)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var stats container.StatsResponse
	err = json.NewDecoder(resp.Body).Decode(&stats)
	if err != nil {
		return nil, err
	}

	prevStats, hasPrevStats := p.containerStatsCache[containerId]
	var timeElapsed float64
	var prevCpuUsage, prevSystemUsage uint64

	if hasPrevStats {
		prevCpuUsage = prevStats.CPUUsage
		prevSystemUsage = prevStats.SystemUsage
		timeElapsed = time.Since(prevStats.Timestamp).Seconds()
	}

	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - prevCpuUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage - prevSystemUsage)
	cpuPercent := 0.0
	if systemDelta > 0 && cpuDelta > 0 {
		cpuPercent = (cpuDelta / systemDelta) * float64(stats.CPUStats.OnlineCPUs) * 100.0
	}

	interfaces := make(map[string]NodeInterfaceStats)

	for ifName, ifStats := range stats.Networks {
		var rxBps, txBps int
		var prevRxBytes, prevTxBytes uint64

		if hasPrevStats {
			if prevIfaceStates, ok := prevStats.Interfaces[ifName]; ok {
				prevRxBytes = prevIfaceStates.RxBytes
				prevTxBytes = prevIfaceStates.TxBytes
			}

			rxBps = int(float64(ifStats.RxBytes-prevRxBytes) / timeElapsed)
			txBps = int(float64(ifStats.TxBytes-prevTxBytes) / timeElapsed)
		}

		interfaces[ifName] = NodeInterfaceStats{
			RxBytes: ifStats.RxBytes,
			TxBytes: ifStats.TxBytes,
			RxBps:   rxBps,
			TxBps:   txBps,
		}
	}

	nodeStats := &NodeStats{
		Timestamp:       time.Now(),
		CPUUsage:        stats.CPUStats.CPUUsage.TotalUsage,
		SystemUsage:     stats.CPUStats.SystemUsage,
		CPUUsagePercent: cpuPercent,
		MemoryUsage:     stats.MemoryStats.Usage - stats.MemoryStats.Stats["cache"],
		MemoryLimit:     stats.MemoryStats.Limit,
		Interfaces:      interfaces,
	}

	p.containerStatsCache[containerId] = nodeStats

	return nodeStats, nil
}

func closeDockerClient(client *client.Client) {
	_ = client.Close()
}

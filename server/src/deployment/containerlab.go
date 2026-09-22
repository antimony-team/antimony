package deployment

import (
	"antimonyBackend/utils"
	"antimonyBackend/utils/serverlog"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/docker/docker/errdefs"
	"github.com/docker/docker/pkg/stdcopy"
	afpacket "github.com/google/gopacket/afpacket"
	"github.com/vishvananda/netns"
)

type ContainerlabProvider struct {
	client *client.Client

	statsReader *StatsReader[dockerRef]
}

type dockerExecSession struct {
	net.Conn
	client *client.Client
	execId string
}

func CreateContainerlabProvider() *ContainerlabProvider {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("Failed to create containerlab client: %s", err.Error())
	}

	provider := &ContainerlabProvider{
		client: cli,
	}

	provider.statsReader = CreateStatsReader(createDockerSampler(provider.resolveNode))

	return provider
}

func (p *ContainerlabProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "deploy", "-t", topologyFile)
	output, err := runCommandSync(cmd, serverlog.FormatClabLog(onLog))

	sendClabOutput(output, onLog)

	return err
}

func (p *ContainerlabProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "redeploy", "-t", topologyFile)
	output, err := runCommandSync(cmd, serverlog.FormatClabLog(onLog))

	sendClabOutput(output, onLog)

	return err
}

func (p *ContainerlabProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog func(data string),
) error {
	cmd := exec.CommandContext(ctx, "containerlab", "destroy", "-t", topologyFile)
	output, err := runCommandSync(cmd, serverlog.FormatClabLog(onLog))

	sendClabOutput(output, onLog)

	return err
}

func (p *ContainerlabProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog func(data string),
) (InspectOutput, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "-t", topologyFile, "--format", "json")
	rawOutput, err := runCommandSync(cmd, serverlog.FormatClabLog(onLog))

	if err != nil {
		return nil, err
	}

	if *rawOutput == "" {
		return InspectOutput{}, nil
	}

	var inspectOutput InspectOutput
	if err = json.Unmarshal([]byte(*rawOutput), &inspectOutput); err != nil {
		return nil, err
	}

	// Strip the containerlab prefix from the container names
	containerNamePrefix := fmt.Sprintf("clab-%s-", instanceName)
	for _, lab := range inspectOutput {
		for i := range lab {
			lab[i].ContainerName = lab[i].Name
			lab[i].Name = strings.TrimPrefix(lab[i].Name, containerNamePrefix)
		}
	}

	return inspectOutput, err
}

func (p *ContainerlabProvider) InspectAll(
	ctx context.Context,
) (InspectOutput, error) {
	cmd := exec.CommandContext(ctx, "containerlab", "inspect", "--all", "--format", "json")
	if output, err := runCommandSync(cmd, nil); err != nil {
		return nil, err
	} else {
		if *output == "" {
			return InspectOutput{}, nil
		}

		var inspectOutput InspectOutput
		err = json.Unmarshal([]byte(*output), &inspectOutput)

		// Strip the containerlab prefix from the container names
		for labName, lab := range inspectOutput {
			containerNamePrefix := fmt.Sprintf("clab-%s-", labName)
			for i := range lab {
				lab[i].ContainerName = lab[i].Name
				lab[i].Name = strings.TrimPrefix(lab[i].Name, containerNamePrefix)
			}
		}

		return inspectOutput, err
	}
}

func (p *ContainerlabProvider) Exec(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (string, int, error) {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return "", 0, err
	}

	execId, err := p.createExec(ctx, containerId, cmd, false)
	if err != nil {
		return "", 0, err
	}

	hr, err := p.client.ContainerExecAttach(ctx, execId, container.ExecAttachOptions{})
	if err != nil {
		return "", 0, err
	}
	defer hr.Close()

	var out bytes.Buffer
	_, _ = stdcopy.StdCopy(&out, &out, hr.Reader)

	insp, err := p.client.ContainerExecInspect(ctx, execId)
	if err != nil {
		return out.String(), 0, err
	}

	return out.String(), insp.ExitCode, nil
}

func (p *ContainerlabProvider) ExecInteractive(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (ShellExecSession, error) {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return nil, err
	}

	execId, err := p.createExec(ctx, containerId, cmd, true)
	if err != nil {
		return nil, err
	}

	hr, err := p.client.ContainerExecAttach(ctx, execId, container.ExecAttachOptions{Tty: true})
	if err != nil {
		return nil, err
	}

	time.Sleep(20 * time.Millisecond)

	inspect, err := p.client.ContainerExecInspect(ctx, execId)
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

	return &dockerExecSession{Conn: hr.Conn, client: p.client, execId: execId}, nil
}

func (p *ContainerlabProvider) DialNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
	port int,
) (net.Conn, error) {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return nil, err
	}

	insp, err := p.client.ContainerInspect(ctx, containerId)
	if err != nil {
		return nil, err
	}
	ip := insp.NetworkSettings.IPAddress
	for _, n := range insp.NetworkSettings.Networks {
		if n.IPAddress != "" {
			ip = n.IPAddress
			break
		}
	}
	var d net.Dialer
	return d.DialContext(ctx, "tcp", fmt.Sprintf("%s:%d", ip, port))
}

func (p *ContainerlabProvider) OpenCapture(
	ctx context.Context,
	instanceName string,
	nodeName string,
	interfaceName string,
) (*afpacket.TPacket, error) {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return nil, err
	}

	info, err := p.client.ContainerInspect(ctx, containerId)
	if err != nil {
		return nil, fmt.Errorf("inspect %q: %w", containerId, err)
	}
	if info.State == nil || info.State.Pid == 0 {
		return nil, fmt.Errorf("container %q is not running", containerId)
	}

	tp, err := openCaptureInNetns(info.State.Pid, interfaceName)
	if err != nil {
		return nil, fmt.Errorf("open capture on %q/%s: %w", containerId, interfaceName, err)
	}

	return tp, nil
}

func (p *ContainerlabProvider) StartNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return err
	}

	return p.client.ContainerStart(ctx, containerId, container.StartOptions{})
}

func (p *ContainerlabProvider) StopNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	timeout := int(10 * time.Second)
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return err
	}

	return p.client.ContainerStop(ctx, containerId, container.StopOptions{Timeout: &timeout})
}

func (p *ContainerlabProvider) RestartNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	timeout := int(10 * time.Second)
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return err
	}

	return p.client.ContainerRestart(ctx, containerId, container.StopOptions{Timeout: &timeout})
}

func (p *ContainerlabProvider) RegisterListener(ctx context.Context, onUpdate func(nodeName string)) error {
	eventFilter := filters.NewArgs()
	eventFilter.Add("type", "container")
	eventFilter.Add("event", "start")
	eventFilter.Add("event", "stop")
	eventFilter.Add("event", "die")
	eventFilter.Add("event", "destroy")
	eventFilter.Add("event", "create")

	channel, errs := p.client.Events(ctx, events.ListOptions{
		Filters: eventFilter,
	})

	for {
		select {
		case msg := <-channel:
			nodeName := msg.Actor.Attributes["clab-node-name"]
			// Ignore nodes that don't have the clab attribute as they are not part of any containerlab deployment
			if nodeName != "" {
				onUpdate(nodeName)
			}
		case err := <-errs:
			if err != nil {
				log.Errorf("Failed to receive clabernetes events: %s", err.Error())
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (p *ContainerlabProvider) StreamContainerLogs(
	ctx context.Context,
	instanceName string,
	nodeName string,
	onLog func(data string),
) error {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return err
	}

	logOptions := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Timestamps: true,
		Tail:       "all",
	}

	out, err := p.client.ContainerLogs(ctx, containerId, logOptions)
	if err != nil {
		return err
	}

	go streamOutput(out, onLog)

	return nil
}

func (p *ContainerlabProvider) GetNetworkInterfaces(
	ctx context.Context,
	instanceName string,
	nodeName string,
) ([]NodeInterface, error) {
	containerId, err := p.containerForNode(ctx, instanceName, nodeName)
	if err != nil {
		return nil, err
	}

	info, err := p.client.ContainerInspect(ctx, containerId)
	if err != nil {
		return nil, err
	}

	if info.State == nil || info.State.Pid == 0 {
		return nil, utils.ErrNodeNotRunning
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

func (p *ContainerlabProvider) ReadNodeStats(
	ctx context.Context,
	instanceName string,
	nodeName string,
) (*NodeStats, error) {
	nodeId := instanceName + "/" + nodeName

	return p.statsReader.Read(ctx, nodeId, dockerRef{instanceName, nodeName})
}

func (p *ContainerlabProvider) createExec(
	ctx context.Context,
	containerId string,
	cmd []string,
	tty bool,
) (string, error) {
	resp, err := p.client.ContainerExecCreate(ctx, containerId, container.ExecOptions{
		Cmd:          cmd,
		AttachStdin:  tty,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          tty,
	})

	if errdefs.IsConflict(err) {
		return "", utils.ErrNodeNotRunning
	}

	if err != nil {
		return "", err
	}

	return resp.ID, nil
}

// containerForNode returns the id of the container backing a node, running
// or not. It returns ErrNodeNotFound if no such container exists.
func (p *ContainerlabProvider) containerForNode(ctx context.Context, instanceName, nodeName string) (string, error) {
	f := filters.NewArgs()
	f.Add("label", "containerlab="+instanceName)
	f.Add("label", "clab-node-name="+nodeName)

	containers, err := p.client.ContainerList(ctx, container.ListOptions{All: true, Filters: f})
	if err != nil {
		return "", err
	}
	if len(containers) == 0 {
		return "", fmt.Errorf("%w: %s/%s", utils.ErrNodeNotFound, instanceName, nodeName)
	}
	return containers[0].ID, nil
}

func (p *ContainerlabProvider) resolveNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) (dockerTarget, error) {
	id, err := p.containerForNode(ctx, instanceName, nodeName)

	if err != nil {
		return dockerTarget{}, err
	}

	insp, err := p.client.ContainerInspect(ctx, id)
	if err != nil {
		return dockerTarget{}, err
	}

	if insp.State == nil || insp.State.Pid <= 0 {
		return dockerTarget{}, fmt.Errorf("%w: %s/%s", utils.ErrNodeNotRunning, instanceName, nodeName)
	}

	return dockerTarget{fullContainerId: insp.ID, pid: insp.State.Pid}, nil
}

func (t *dockerExecSession) Resize(cols uint, rows uint) error {
	return t.client.ContainerExecResize(context.Background(), t.execId, container.ResizeOptions{
		Width:  cols,
		Height: rows,
	})
}

// sendClabOutput sends the data from the containerlab stdout to the log
// This function strips all ansi characters and splits the data into lines
func sendClabOutput(output *string, onLog func(data string)) {
	if output != nil {
		lines := strings.Split(*output, "\n")
		for _, line := range lines {
			if line != "" {
				onLog(serverlog.ReplaceAnsiCharacters(line))
			}
		}
	}
}

func openCaptureInNetns(pid int, interfaceName string) (*afpacket.TPacket, error) {
	runtime.LockOSThread()

	orig, err := netns.Get()
	if err != nil {
		runtime.UnlockOSThread()
		return nil, fmt.Errorf("get current netns: %w", err)
	}

	targetNs, err := netns.GetFromPid(pid)
	if err != nil {
		_ = orig.Close()
		runtime.UnlockOSThread()
		return nil, fmt.Errorf("get netns for pid %d: %w", pid, err)
	}
	defer targetNs.Close()

	if err := netns.Set(targetNs); err != nil {
		_ = orig.Close()
		runtime.UnlockOSThread()
		return nil, fmt.Errorf("enter target netns: %w", err)
	}

	tp, err := afpacket.NewTPacket(afpacket.OptInterface(interfaceName))

	if revertErr := netns.Set(orig); revertErr != nil {
		_ = orig.Close()
		if tp != nil {
			tp.Close()
		}
		runtime.Goexit()
	}

	_ = orig.Close()
	runtime.UnlockOSThread()

	return tp, err
}

var nodeStateNames = map[string]NodeState{
	"starting": NodeStates.Starting,
	"running":  NodeStates.Running,
	"exited":   NodeStates.Stopped,
	"dead":     NodeStates.Stopped,
	"created":  NodeStates.Stopped,
}

// We need to translate the containerlab's node state names to our own node state enum.
func (s *NodeState) UnmarshalText(b []byte) error {
	v, ok := nodeStateNames[strings.ToLower(string(b))]
	if !ok {
		return fmt.Errorf("unknown node state %q", b)
	}
	*s = v
	return nil
}

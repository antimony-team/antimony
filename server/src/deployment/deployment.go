package deployment

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/google/gopacket/afpacket"
)

type DeploymentProvider interface {
	Deploy(
		ctx context.Context,
		topologyFile string,
		instanceName string,
		onLog func(data string),
	) error

	Redeploy(
		ctx context.Context,
		topologyFile string,
		instanceName string,
		onLog func(data string),
	) error

	Destroy(
		ctx context.Context,
		topologyFile string,
		instanceName string,
		onLog func(data string),
	) error

	Inspect(
		ctx context.Context,
		topologyFile string,
		instanceName string,
		onLog func(data string),
	) (InspectOutput, error)

	InspectAll(ctx context.Context) (InspectOutput, error)

	Exec(
		ctx context.Context,
		instanceName string,
		nodeName string,
		cmd []string,
	) (string, int, error)

	ExecInteractive(
		ctx context.Context,
		instanceName string,
		nodeName string,
		cmd []string,
	) (ShellExecSession, error)

	// DialNode opens a TCP connection to a port on the node's management interface.
	DialNode(ctx context.Context, instanceName string, nodeName string, port int) (net.Conn, error)

	RegisterListener(ctx context.Context, onUpdate func(nodeName string)) error

	ReadNodeStats(
		ctx context.Context,
		instanceName string,
		nodeName string,
	) (*NodeStats, error)

	OpenCapture(
		ctx context.Context,
		instanceName string,
		nodeName string,
		interfaceName string,
	) (*afpacket.TPacket, error)

	StartNode(
		ctx context.Context,
		instanceName string,
		nodeName string,
	) error

	StopNode(
		ctx context.Context,
		instanceName string,
		nodeName string,
	) error

	RestartNode(
		ctx context.Context,
		instanceName string,
		nodeName string,
	) error

	StreamContainerLogs(
		ctx context.Context,
		instanceName string,
		nodeName string,
		onLog func(data string),
	) error

	// GetNetworkInterfaces returns a list of network interfaces for a node.
	//
	// Returns a [utils.ErrNodeNotRunning] if the node is currently not running.
	GetNetworkInterfaces(
		ctx context.Context,
		instanceName string,
		nodeName string,
	) ([]NodeInterface, error)
}

type ShellExecSession interface {
	io.ReadWriteCloser
	Resize(cols uint, rows uint) error
}

type InspectOutput = map[string][]InspectContainer

type InspectContainer struct {
	LabName       string    `json:"lab_name"`
	LabPath       string    `json:"labPath"`
	Name          string    `json:"name"`
	ContainerId   string    `json:"container_id"`
	ContainerName string    `json:"container_name"`
	Image         string    `json:"image"`
	Kind          string    `json:"kind"`
	State         NodeState `json:"state"`
	IPv4Address   string    `json:"ipv4_address"`
	IPv6Address   string    `json:"ipv6_address"`
	Owner         string    `json:"owner"`
}

type NodeState int

const (
	starting NodeState = iota
	running
	stopped
)

var NodeStates = struct {
	Starting NodeState
	Running  NodeState
	Stopped  NodeState
}{
	Starting: starting,
	Running:  running,
	Stopped:  stopped,
}

type ContainerlabEvent struct {
	Timestamp   time.Time       `json:"timestamp"`
	Type        string          `json:"type"`
	Action      string          `json:"action"`
	ActorID     string          `json:"actor_id"`
	ActorName   string          `json:"actor_name"`
	ActorFullID string          `json:"actor_full_id"`
	Attributes  json.RawMessage `json:"attributes"`
}

type NodeInterface struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	MTU     int    `json:"mtu"`
	State   string `json:"state"`
}

type InterfaceEventAttributes struct {
	ID              string `json:"id"`
	Ifname          string `json:"ifname"`
	Index           string `json:"index"`
	IntervalSeconds string `json:"interval_seconds"`
	Lab             string `json:"lab"`
	MAC             string `json:"mac"`
	MTU             string `json:"mtu"`
	Name            string `json:"name"`
	Origin          string `json:"origin"`
	RxBps           string `json:"rx_bps"`
	RxBytes         string `json:"rx_bytes"`
	RxPackets       string `json:"rx_packets"`
	RxPps           string `json:"rx_pps"`
	State           string `json:"state"`
	TxBps           string `json:"tx_bps"`
	TxBytes         string `json:"tx_bytes"`
	TxPackets       string `json:"tx_packets"`
	Type            string `json:"type"`
}

type NodeStats struct {
	Timestamp time.Time

	CPUUsage        uint64
	SystemUsage     uint64
	CPUUsagePercent float64

	MemoryUsage uint64
	MemoryLimit uint64

	Interfaces map[string]NodeInterfaceStats
}

type NodeInterfaceStats struct {
	RxBytes uint64
	TxBytes uint64

	RxBps int
	TxBps int
}

func runCommandSync(cmd *exec.Cmd, onStderr func(string)) (*string, error) {
	var outputBuffer bytes.Buffer
	cmd.Stdout = &outputBuffer

	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Errorf("stderr pipe error: %v", err)
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	go streamOutput(stderr, onStderr)

	err = cmd.Wait()
	output := outputBuffer.String()

	if err != nil {
		err = fmt.Errorf("sub-process '%s' failed: %s", cmd.String(), err)
	}

	return &output, err
}

func runClabCommand(cmd *exec.Cmd, onLog func(string), onDone func(*string, error)) {
	var outputBuffer bytes.Buffer
	cmd.Stdout = &outputBuffer

	stderr, err := cmd.StderrPipe()
	if err != nil {
		onDone(nil, err)
		return
	}

	if err := cmd.Start(); err != nil {
		onDone(nil, err)
		return
	}

	go streamOutput(stderr, onLog)

	err = cmd.Wait()
	output := outputBuffer.String()
	onDone(&output, err)
}

func streamOutput(pipe io.Reader, onLog func(data string)) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		if onLog != nil {
			onLog(scanner.Text())
		}
	}
	if err := scanner.Err(); err != nil {
		return
	}
}

func readFileOrEmpty(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

package deployment

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"time"

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

	// InspectLabs returns a list of [InspectContainer] of all currently running labs indexed by their instance names.
	InspectLabs(
		ctx context.Context,
		onLog func(data string),
	) (map[string][]InspectContainer, error)

	// InspectLabs returns a list of [InspectContainer] for all nodes in a specific lab.
	InspectLab(
		ctx context.Context,
		topologyFile string,
		instanceName string,
		onLog func(data string),
	) ([]InspectContainer, error)

	// InspectLabs returns an [InspectContainer] for a specific node in a lab.
	InspectNode(
		ctx context.Context,
		topologyFile string,
		instanceName string,
		nodeName string,
		onLog func(data string),
	) (InspectContainer, error)

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

type InspectContainer struct {
	Name          string    `json:"name"`
	LabName       string    `json:"lab_name"`
	LabPath       string    `json:"labPath"`
	Image         string    `json:"image"`
	State         NodeState `json:"state"`
	ContainerId   string    `json:"container_id"`
	ContainerName string    `json:"container_name"`
	IPv4Address   string    `json:"ipv4_address"`
	IPv6Address   string    `json:"ipv6_address"`
}

type NodeState int

const (
	stopped NodeState = iota
	starting
	running
	stopping
)

var NodeStates = struct {
	Stopped  NodeState
	Starting NodeState
	Running  NodeState
	Stopping NodeState
}{
	Stopped:  stopped,
	Starting: starting,
	Running:  running,
	Stopping: stopping,
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

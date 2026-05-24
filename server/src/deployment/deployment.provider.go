package deployment

import (
	"context"
	"encoding/json"
	"io"
	"time"
)

type DeploymentProvider interface {
	Deploy(ctx context.Context, topologyFile string, onLog func(data string)) (*string, error)
	Destroy(ctx context.Context, topologyFile string, onLog func(data string)) (*string, error)
	Inspect(ctx context.Context, topologyFile string, onLog func(data string)) (InspectOutput, error)
	InspectAll(ctx context.Context) (InspectOutput, error)
	Redeploy(ctx context.Context, topologyFile string, onLog func(data string)) (*string, error)

	ExecInteractive(ctx context.Context, containerId string, cmd []string) (io.ReadWriteCloser, error)

	RegisterListener(ctx context.Context, onUpdate func(containerId string)) error
	RegisterEventListener(ctx context.Context, onUpdate func(containerlabEvent ContainerlabEvent)) error

	StartNode(ctx context.Context, containerId string) error
	StopNode(ctx context.Context, containerId string) error
	RestartNode(ctx context.Context, containerId string) error

	StreamContainerLogs(ctx context.Context, topologyFile string, containerID string, onLog func(data string)) error

	GetInterfaces(ctx context.Context, containerId string) ([]string, error)
}

type InspectOutput = map[string][]InspectContainer

type InspectContainer struct {
	LabName     string    `json:"lab_name"`
	LabPath     string    `json:"labPath"`
	Name        string    `json:"name"`
	ContainerId string    `json:"container_id"`
	Image       string    `json:"image"`
	Kind        string    `json:"kind"`
	State       NodeState `json:"state"`
	IPv4Address string    `json:"ipv4_address"`
	IPv6Address string    `json:"ipv6_address"`
	Owner       string    `json:"owner"`
}

type NodeState string

const (
	starting NodeState = "starting"
	running  NodeState = "running"
	exited   NodeState = "exited"
)

var NodeStates = struct {
	Starting NodeState
	Running  NodeState
	Exited   NodeState
}{
	Starting: starting,
	Running:  running,
	Exited:   exited,
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

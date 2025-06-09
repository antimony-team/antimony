package deployment

import (
	"context"
	"io"
)

type DeploymentProvider interface {
	Deploy(ctx context.Context, topologyFile string, onLog func(data string)) (output *string, err error)
	Destroy(ctx context.Context, topologyFile string, onLog func(data string)) (output *string, err error)
	Inspect(ctx context.Context, topologyFile string, onLog func(data string)) (output InspectOutput, err error)
	InspectAll(ctx context.Context) (InspectOutput, error)
	Redeploy(ctx context.Context, topologyFile string, onLog func(data string)) (output *string, err error)

	OpenShell(ctx context.Context, containerId string) (io.ReadWriteCloser, error)

	RegisterListener(ctx context.Context, onUpdate func(containerId string)) error

	StartNode(ctx context.Context, containerId string) error
	StopNode(ctx context.Context, containerId string) error
	RestartNode(ctx context.Context, containerId string) error

	StreamContainerLogs(ctx context.Context, topologyFile string, containerID string, onLog func(data string)) error
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
	running NodeState = "running"
	exited            = "exited"
)

var NodeStates = struct {
	Running NodeState
	exited  NodeState
}{
	Running: running,
	exited:  exited,
}

package deployment

import (
	"context"
)

type DeploymentProvider interface {
	Deploy(ctx context.Context, topologyFile string, onLog func(data string)) (output *string, err error)
	Destroy(ctx context.Context, topologyFile string, onLog func(data string)) (output *string, err error)
	Inspect(ctx context.Context, topologyFile string, onLog func(data string)) (output *InspectOutput, err error)
	InspectAll(ctx context.Context) (*InspectOutput, error)
	Redeploy(ctx context.Context, topologyFile string, onLog func(data string)) (output *string, err error)

	Exec(ctx context.Context, topologyFile string, content string, onLog func(data string), onDone func(output *string, err error))
	ExecOnNode(ctx context.Context, topologyFile string, content string, nodeName string, onLog func(data string), onDone func(output *string, err error))
	Save(ctx context.Context, topologyFile string, onLog func(data string), onDone func(output *string, err error))
	SaveOnNode(ctx context.Context, topologyFile string, nodeName string, onLog func(data string), onDone func(output *string, err error))
	StreamContainerLogs(ctx context.Context, topologyFile string, containerID string, onLog func(data string)) error
}

type InspectOutput struct {
	Containers []InspectContainer
}

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
	running NodeState
	exited  NodeState
}{
	running: running,
	exited:  exited,
}

package instance

import (
	"antimonyBackend/deployment"
	"antimonyBackend/socket"
	"context"
	"sync"
	"time"
)

type Instance struct {
	// Immutable after construction; safe to read without locking.
	Name         string
	TopologyFile string
	NodeKinds    map[string]string
	NodeLabels   map[string]map[string]string
	LogNamespace *socket.OutputNamespace[string]

	// DataMutex guards the mutable state below.
	DataMutex         sync.Mutex
	Deployed          time.Time
	LatestStateChange time.Time
	State             InstanceState
	Nodes             []*InstanceNode
	// Recovered specifies whether the instance has been recovered after an Antimony restart
	Recovered bool
	// IsDestroyed Whether the instance has been destroyed
	IsDestroyed bool

	// OperationMutex is the mutex that serializes deployment operations (deploy, destroy, node commands)
	OperationMutex sync.Mutex

	// DeploymentCtx holds the context of the current deployment. All runtime instance functions,
	// such as startup listeners and log streamers, are tied to its lifecycle. Canceling the
	// context will terminate all current operations and release the OperationMutex.
	DeploymentCtx    context.Context
	DeploymentCancel context.CancelFunc
	DeploymentMutex  sync.Mutex
}

func (i *Instance) deploymentContext() context.Context {
	i.DeploymentMutex.Lock()
	defer i.DeploymentMutex.Unlock()

	return i.DeploymentCtx
}

type InstanceNode struct {
	// Name is the name of the node as defined in the topology file.
	Name string `json:"name"`

	// Kind is the type of the node as defined in the topology file.
	Kind string `json:"kind"`

	// IPv4 and IPv6 are the management IP addresses assigned by the deployment backend.
	IPv4 string `json:"ipv4"`
	IPv6 string `json:"ipv6"`

	// State is the current state of the node.
	State deployment.NodeState `json:"state"`

	// ContainerId is the globally unique identifier for the container running the node.
	// In containerlab this is the node's docker container ID.
	// In clabernetes this is the node's pod UID.
	ContainerId string `json:"containerId"`

	// ContainerName is the name of the container running the node. Currently unused outside of display purposes.
	// In containerlab this is the node's docker container name.
	// In clabernetes this is equal to the node's name.
	ContainerName string `json:"containerName"`

	// Interfaces are the network interfaces of the node. Fetched after the node's startup listener succeeded.
	Interfaces []deployment.NodeInterface `json:"interfaces"`

	// CanRestart whether the node can be restarted. Determined by the node's kind and the kind config file.
	CanRestart bool `json:"canRestart"`
}

type InstanceState int

const (
	deploying InstanceState = iota
	running
	stopping
	failed

	// Pseudo-states that are defined by the absence of an Instance in a Lab.
	//
	// Lab has no Instance and the Lab.StartTime is in the past -> inactive.
	// Lab has no Instance and the Lab.StartTime is in the future -> scheduled.
	inactive  InstanceState = -1
	scheduled InstanceState = -2
)

var InstanceStates = struct {
	Deploying InstanceState
	Stopping  InstanceState
	Running   InstanceState
	Failed    InstanceState
	Scheduled InstanceState
	Inactive  InstanceState
}{
	Deploying: deploying,
	Stopping:  stopping,
	Running:   running,
	Failed:    failed,
	Scheduled: scheduled,
	Inactive:  inactive,
}

type NodeKindConfig struct {
	SSHUsername *string `yaml:"sshUsername"`
	SSHPassword *string `yaml:"sshPassword"`
	CanRestart  *bool   `yaml:"canRestart"`
}

type instanceUpdate struct {
	LabId *string `json:"labId"`
}

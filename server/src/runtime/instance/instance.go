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
	NodeLabels   map[string]map[string]string
	NodeKinds    map[string]string
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
	//
	// Left empty if the node is currently not running or there is no IPv4 or IPv6 address assigned.
	IPv4 string `json:"ipv4"`
	IPv6 string `json:"ipv6"`

	// State is the current state of the node.
	State deployment.NodeState `json:"state"`

	// IsReady is true if the node and its running software (e.g., SRLinux) are fully running and ready to be used.
	// This is initially set to false and set to true once the node's startup listener succeeded.
	IsReady bool `json:"isReady"`

	// ContainerId is the globally unique identifier for the container running the node.
	//
	// With containerlab as the deployment provider, this is the node's docker container ID.
	// With clabernetes as the deployment provider, this is the node's pod UID.
	//
	// Left empty if the node is currently not running.
	ContainerId string `json:"containerId"`

	// ContainerName is the name of the container running the node. Currently unused outside of display purposes.
	//
	// With containerlab as the deployment provider, this is the node's docker container name.
	// With clabernetes as the deployment provider, this is equal to the node's name.
	//
	// Left empty if the node is currently not running.
	ContainerName string `json:"containerName"`

	// Interfaces are the network interfaces of the node. Fetched after the node's startup listener succeeded.
	// Set tpo nil if the node is not running.
	Interfaces []deployment.NodeInterface `json:"interfaces"`

	// CanRestart whether the node can be restarted. Determined by the node's kind and the kind config file.
	CanRestart bool `json:"canRestart"`
}

// Set sets the node's fields to a new state.
//
// We don't set [InstanceNode.IsReady] or [InstanceNode.Interfaces] here as this will be set by the node's startup listener.
func (n *InstanceNode) Set(
	state deployment.NodeState,
	ipv4 string,
	ipv6 string,
	containerId string,
	containerName string,
) {
	n.State = state
	n.IPv4 = ipv4
	n.IPv6 = ipv6
	n.ContainerId = containerId
	n.ContainerName = containerName
}

// Reset resets the node's fields to its non-running state.
func (n *InstanceNode) Reset() {
	n.IPv4 = ""
	n.IPv6 = ""
	n.IsReady = false
	n.ContainerId = ""
	n.ContainerName = ""
	n.State = deployment.NodeStates.Stopping
	n.Interfaces = make([]deployment.NodeInterface, 0)
}

// Set sets the node's fields to its ready state.
//
// We assume [InstanceNode.Set] has already been called.
func (n *InstanceNode) SetReady(
	interfaces []deployment.NodeInterface,
) {
	n.IsReady = true
	n.Interfaces = interfaces
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

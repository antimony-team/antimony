package instance

import (
	"antimonyBackend/deployment"
	"antimonyBackend/socket"
	"context"
	"sync"
	"time"
)

type Instance struct {
	Deployed          time.Time
	State             InstanceState
	LatestStateChange time.Time
	Nodes             []*InstanceNode

	// Recovered Whether the instance has been recovered after an Antimony restart
	Recovered bool

	// DataMutex The mutex that guards mutable instance fields
	DataMutex sync.Mutex

	// OperationMutex The mutex that serializes deployment operations (deploy, destroy, node commands)
	OperationMutex sync.Mutex

	// DeploymentCtx holds the context of the current deployment. All runtime instance functions,
	// such as startup listeners and log streamers, are tied to its lifecycle. Canceling the
	// context will terminate all current operations and release the OperationMutex.
	DeploymentCtx    context.Context
	DeploymentCancel context.CancelFunc
	DeploymentMutex  sync.Mutex

	// IsDestroyed Whether the instance has been destroyed
	IsDestroyed bool

	// Read-only fields that are never changed
	TopologyFile string
	LogNamespace *socket.OutputNamespace[string]
	NodeKinds    map[string]string
	NodeLabels   map[string]map[string]string
}

func (i *Instance) deploymentContext() context.Context {
	i.DeploymentMutex.Lock()
	defer i.DeploymentMutex.Unlock()

	return i.DeploymentCtx
}

type InstanceNode struct {
	Name          string                     `json:"name"`
	Kind          string                     `json:"kind"`
	IPv4          string                     `json:"ipv4"`
	IPv6          string                     `json:"ipv6"`
	State         deployment.NodeState       `json:"state"`
	ContainerId   string                     `json:"containerId"`
	ContainerName string                     `json:"containerName"`
	Interfaces    []deployment.NodeInterface `json:"interfaces"`

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

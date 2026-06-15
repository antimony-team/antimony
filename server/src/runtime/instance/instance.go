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

	TopologyFile       string
	TopologyDefinition string
	LogNamespace       *socket.OutputNamespace[string]

	// Mutex The mutex that is locked whenever an instance operation is in progress (e.g. deploy)
	Mutex sync.Mutex

	// DeploymentCancel that holds the current deployment context of the lab
	DeploymentCancel      context.CancelFunc
	DeploymentCancelMutex sync.Mutex

	// IsDestroyed Whether the instance has been destroyed
	IsDestroyed bool

	NodeKinds  map[string]string
	NodeLabels map[string]map[string]string
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
	LabId    *string        `json:"labId"`
	NewState *InstanceState `json:"newState"`
}

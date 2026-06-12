package instance

import (
	"antimonyBackend/deployment"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"sync"
	"time"
)

type Instance struct {
	Deployed          time.Time
	State             InstanceState
	LatestStateChange time.Time
	Nodes             []InstanceNode

	// Recovered Whether the instance has been recovered after an Antimony restart
	Recovered bool

	TopologyFile       string
	TopologyDefinition string
	LogNamespace       *socket.OutputNamespace[string]

	// Mutex The mutex that is locked whenever an instance operation is in progress (e.g. deploy)
	Mutex sync.Mutex

	// DeploymentWorker that holds the current deployment context of the lab
	DeploymentWorker *utils.Worker

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

type InstanceNodeOut struct {
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

type InstanceCommand int

const (
	deployCommand InstanceCommand = iota
	destroyCommand
	startNodeCommand
	stopNodeCommand
	restartNodeCommand
	fetchShellsCommand
	openShellCommand
	closeShellCommand
)

var InstanceCommands = struct {
	Deploy      InstanceCommand
	Destroy     InstanceCommand
	StopNode    InstanceCommand
	StartNode   InstanceCommand
	RestartNode InstanceCommand
	FetchShells InstanceCommand
	OpenShell   InstanceCommand
	CloseShell  InstanceCommand
}{
	Deploy:      deployCommand,
	Destroy:     destroyCommand,
	StopNode:    stopNodeCommand,
	StartNode:   startNodeCommand,
	RestartNode: restartNodeCommand,
	FetchShells: fetchShellsCommand,
	OpenShell:   openShellCommand,
	CloseShell:  closeShellCommand,
}

type InstanceCommandData struct {
	LabId   *string          `json:"labId"`
	Command *InstanceCommand `json:"command"`
	Node    *string          `json:"node"`
	ShellId *string          `json:"shellId"`
}

type NodeKindConfig struct {
	SSHUsername *string `yaml:"sshUsername"`
	SSHPassword *string `yaml:"sshPassword"`
	CanRestart  *bool   `yaml:"canRestart"`
}

type InstanceUpdate struct {
	LabId    *string        `json:"labId"`
	NewState *InstanceState `json:"newState"`
}

type ShellData struct {
	Id   string `json:"id"`
	Node string `json:"node"`
}

type ShellCommandData struct {
	LabId   string       `json:"labId"`
	Command ShellCommand `json:"command"`
	Node    string       `json:"node"`
	ShellId string       `json:"shellId"`
	Message string       `json:"message"`
}

type ShellCommand int

const (
	shellError ShellCommand = iota
	shellClose
)

var ShellCommands = struct {
	Error ShellCommand
	Close ShellCommand
}{
	Error: shellError,
	Close: shellClose,
}

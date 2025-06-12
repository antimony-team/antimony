package lab

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"sync"
	"time"

	"gorm.io/gorm"
)

type Lab struct {
	gorm.Model
	UUID               string     `gorm:"uniqueIndex;not null"`
	Name               string     `gorm:"index;not null"`
	StartTime          time.Time  `gorm:"index;not null"`
	EndTime            *time.Time `gorm:"index"`
	Topology           topology.Topology
	TopologyID         uint `gorm:"not null"`
	Creator            user.User
	CreatorID          uint    `gorm:"not null"`
	InstanceName       *string `gorm:"uniqueIndex"`
	TopologyDefinition *string
}

type LabIn struct {
	Name       *string    `json:"name"       binding:"required"`
	StartTime  *time.Time `json:"startTime"  binding:"required"`
	EndTime    *time.Time `json:"endTime"    binding:"required"`
	TopologyId *string    `json:"topologyId" binding:"required"`
}

type LabInPartial struct {
	Name       *string    `json:"name"`
	StartTime  *time.Time `json:"startTime"`
	EndTime    *time.Time `json:"endTime"`
	Indefinite *bool      `json:"indefinite"`
}

type LabOut struct {
	ID                 string       `json:"id"`
	Name               string       `json:"name"`
	StartTime          time.Time    `json:"startTime"`
	EndTime            *time.Time   `json:"endTime"`
	TopologyId         string       `json:"topologyId"`
	CollectionId       string       `json:"collectionId"`
	Creator            user.UserOut `json:"creator"`
	TopologyDefinition string       `json:"topologyDefinition"`
	Instance           *InstanceOut `json:"instance,omitempty"     extensions:"x-nullable"`
	InstanceName       *string      `json:"instanceName,omitempty" extensions:"x-nullable"`
}

type LabFilter struct {
	Limit            int             `form:"limit"`
	Offset           int             `form:"offset"`
	SearchQuery      *string         `form:"searchQuery"`
	StartDate        *time.Time      `form:"startDate"`
	EndDate          *time.Time      `form:"endDate"`
	StateFilter      []InstanceState `form:"stateFilter[]"`
	CollectionFilter []string        `form:"collectionFilter[]"`
}

type Instance struct {
	Deployed          time.Time
	EdgesharkLink     string
	State             InstanceState
	LatestStateChange time.Time
	Nodes             []InstanceNode

	// Recovered Whether the instance has been recovered after an Antimony restart
	Recovered bool

	TopologyFile string
	LogNamespace socket.OutputNamespace[string]

	// Mutex The mutex that is locked whenever an instance operation is in progress (e.g. deploy)
	Mutex sync.Mutex

	// DeploymentWorker that holds the current deployment context of the lab
	DeploymentWorker *utils.Worker
}

type InstanceOut struct {
	Name              string         `json:"name"`
	Deployed          time.Time      `json:"deployed"`
	EdgesharkLink     string         `json:"edgesharkLink"`
	State             InstanceState  `json:"state"`
	LatestStateChange time.Time      `json:"latestStateChange"`
	Nodes             []InstanceNode `json:"nodes"`
	Recovered         bool           `json:"recovered"`
}

type InstanceNode struct {
	Name          string               `json:"name"`
	IPv4          string               `json:"ipv4"`
	IPv6          string               `json:"ipv6"`
	Port          int                  `json:"port"`
	User          string               `json:"user"`
	WebSSH        string               `json:"webSSH"`
	State         deployment.NodeState `json:"state"`
	ContainerId   string               `json:"containerId"`
	ContainerName string               `json:"containerName"`
}

type ShellData struct {
	Id   string `json:"id"`
	Node string `json:"node"`
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

type LabCommandData struct {
	LabId   *string     `json:"labId"`
	Command *LabCommand `json:"command"`
	Node    *string     `json:"node"`
	ShellId *string     `json:"shellId"`
}

type LabCommand int

const (
	deployCommand LabCommand = iota
	destroyCommand
	stopNodeCommand
	startNodeCommand
	restartNodeCommand
	fetchShellsCommand
	openShellCommand
	closeShellCommand
)

var LabCommands = struct {
	Deploy      LabCommand
	Destroy     LabCommand
	StopNode    LabCommand
	StartNode   LabCommand
	RestartNode LabCommand
	FetchShells LabCommand
	OpenShell   LabCommand
	CloseShell  LabCommand
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

package lab

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"gorm.io/gorm"
	"sync"
	"time"
)

type Lab struct {
	gorm.Model
	UUID         string    `gorm:"uniqueIndex;not null"`
	Name         string    `gorm:"index;not null"`
	StartTime    time.Time `gorm:"index;not null"`
	EndTime      time.Time `gorm:"index;not null"`
	Topology     topology.Topology
	TopologyID   uint `gorm:"not null"`
	Creator      user.User
	CreatorID    uint    `gorm:"not null"`
	InstanceName *string `gotm:"uniqueIndex"`
}

type LabIn struct {
	Name       string    `json:"name"`
	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	TopologyId string    `json:"topologyId"`
}

type LabOut struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	StartTime    time.Time    `json:"startTime"`
	EndTime      time.Time    `json:"endTime"`
	TopologyId   string       `json:"topologyId"`
	CollectionId string       `json:"collectionId"`
	Creator      user.UserOut `json:"creator"`
	Instance     *Instance    `json:"instance,omitempty"`
	InstanceName *string      `json:"instanceName,omitempty"`
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
	Deployed          time.Time      `json:"deployed"`
	EdgesharkLink     string         `json:"edgesharkLink"`
	State             InstanceState  `json:"state"`
	LatestStateChange time.Time      `json:"latestStateChange"`
	Nodes             []InstanceNode `json:"nodes"`

	// Recovered Whether the instance has been recovered after an Antimony restart
	Recovered bool `json:"recovered"`

	// Server-only fields
	TopologyFile string                          `json:"-"`
	LogNamespace socket.NamespaceManager[string] `json:"-"`
	Mutex        sync.Mutex                      `json:"-"`
}

type InstanceNode struct {
	Name        string               `json:"name"`
	IPv4        string               `json:"ipv4"`
	IPv6        string               `json:"ipv6"`
	Port        int                  `json:"port"`
	User        string               `json:"user"`
	WebSSH      string               `json:"webSSH"`
	ContainerId string               `json:"containerId"`
	State       deployment.NodeState `json:"state"`
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
	LabId   string     `json:"labId"`
	Command LabCommand `json:"command"`
	Node    *string    `json:"node"`
}

type LabCommand int

const (
	deployCommand LabCommand = iota
	destroyCommand
	stopNodeCommand
	startNodeCommand
)

var LabCommands = struct {
	Deploy    LabCommand
	Destroy   LabCommand
	StopNode  LabCommand
	StartNode LabCommand
}{
	Deploy:    deployCommand,
	Destroy:   destroyCommand,
	StopNode:  stopNodeCommand,
	StartNode: startNodeCommand,
}

type LabAction int

const (
	deployAction LabAction = iota
	destroyAction
	redeployAction
)

var LabActions = struct {
	Deploy   LabAction
	Destroy  LabAction
	Redeploy LabAction
}{
	Deploy:   deployAction,
	Destroy:  destroyAction,
	Redeploy: redeployAction,
}

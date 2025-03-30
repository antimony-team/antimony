package lab

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"gorm.io/gorm"
	"time"
)

type Lab struct {
	gorm.Model
	UUID       string    `gorm:"uniqueIndex;not null"`
	Name       string    `gorm:"index;not null"`
	StartTime  time.Time `gorm:"index;not null"`
	EndTime    time.Time `gorm:"index;not null"`
	Topology   topology.Topology
	TopologyID uint `gorm:"not null"`
	Creator    user.User
	CreatorID  uint `gorm:"not null"`
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
}

type LabFilter struct {
	Limit            int
	Offset           int
	SearchQuery      string
	StartDate        time.Time
	EndDate          time.Time
	StateFilter      []InstanceState
	CollectionFilter []string
}

type Instance struct {
	Deployed          time.Time      `json:"deployed"`
	EdgesharkLink     string         `json:"edgesharkLink"`
	State             InstanceState  `json:"state"`
	LatestStateChange time.Time      `json:"latestStateChange"`
	Nodes             []InstanceNode `json:"nodes"`
}

type InstanceNode struct {
	Name   string               `json:"name"`
	IPv4   string               `json:"ipv4"`
	IPv6   string               `json:"ipv6"`
	Port   int                  `json:"port"`
	User   string               `json:"user"`
	WebSSH string               `json:"webSSH"`
	State  deployment.NodeState `json:"state"`
}

type InstanceState int

const (
	deploying InstanceState = iota
	stopping
	running
	failed
	inactive
)

var InstanceStates = struct {
	Deploying InstanceState
	Stopping  InstanceState
	Running   InstanceState
	Failed    InstanceState
	Inactive  InstanceState
}{
	Deploying: deploying,
	Stopping:  stopping,
	Running:   running,
	Failed:    failed,
	Inactive:  inactive,
}

type LabCommand string

const (
	deploy    LabCommand = "deploy"
	destroy   LabCommand = "destroy"
	redeploy  LabCommand = "redeploy"
	startNode LabCommand = "start-node"
	stopNode  LabCommand = "stop-node"
	saveNode  LabCommand = "save-node"
)

var LabCommands = struct {
	Deploy    LabCommand
	Destroy   LabCommand
	Redeploy  LabCommand
	StartNode LabCommand
	StopNode  LabCommand
	SaveNode  LabCommand
}{
	Deploy:    deploy,
	Destroy:   destroy,
	Redeploy:  redeploy,
	StartNode: startNode,
	StopNode:  stopNode,
	SaveNode:  saveNode,
}

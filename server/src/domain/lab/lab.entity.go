package lab

import (
	"antimonyBackend/src/domain/instance"
	"antimonyBackend/src/domain/topology"
	"antimonyBackend/src/domain/user"
	"gorm.io/gorm"
	"time"
)

type Lab struct {
	gorm.Model
	UUID       string
	Name       string
	StartTime  time.Time
	EndTime    time.Time
	Creator    user.User
	CreatorID  uint
	Topology   topology.Topology
	TopologyID uint

	// Not persisted, set to nil if lab is not running yet
	Instance *instance.Instance `gorm:"-"`
}

type LabIn struct {
	Name       string    `json:"name"`
	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	TopologyId string    `json:"topologyId"`
}

type LabOut struct {
	UUID         string             `json:"uuid"`
	Name         string             `json:"name"`
	StartTime    time.Time          `json:"startTime"`
	EndTime      time.Time          `json:"endTime"`
	CreatorEmail string             `json:"creatorEmail"`
	TopologyId   string             `json:"topologyId"`
	Instance     *instance.Instance `json:"instance,omitempty"`
}

type LabFilter struct {
	Limit            int
	Offset           int
	SearchQuery      string
	StartDate        time.Time
	EndDate          time.Time
	StateFilter      []instance.InstanceState
	CollectionFilter []string
}

type NodeState int

const (
	NodeRunning NodeState = iota
	NodeStopped
)

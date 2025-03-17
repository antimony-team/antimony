package lab

import (
	"antimonyBackend/domain/instance"
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
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	StartTime  time.Time          `json:"startTime"`
	EndTime    time.Time          `json:"endTime"`
	TopologyId string             `json:"topologyId"`
	Creator    user.UserOut       `json:"creator"`
	Instance   *instance.Instance `json:"instance,omitempty"`
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

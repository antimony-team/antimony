package lab

import (
	"antimonyBackend/src/domain/topology"
	"antimonyBackend/src/domain/user"
	"gorm.io/gorm"
	"time"
)

type Lab struct {
	gorm.Model
	UUID              string
	Name              string
	StartTime         time.Time
	EndTime           time.Time
	Edgeshark         string
	State             LabState
	LatestStateChange time.Time
	Creator           user.User
	CreatorID         uint
	Topology          topology.Topology
	TopologyID        uint
}

type LabFilter struct {
	Limit            int
	Offset           int
	SearchQuery      string
	StartDate        time.Time
	EndDate          time.Time
	StateFilter      []LabState
	CollectionFilter []string
}

type LabIn struct {
	Name       string    `json:"name"`
	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	TopologyId string    `json:"topologyId"`
}

type LabOut struct {
	UUID              string    `json:"uuid"`
	Name              string    `json:"name"`
	StartTime         time.Time `json:"startTime"`
	EndTime           time.Time `json:"endTime"`
	Edgeshark         string    `json:"edgeshark"`
	State             LabState  `json:"state"`
	LatestStateChange time.Time `json:"latestStateChange"`
	CreatorEmail      user.User `json:"creatorEmail"`
	TopologyId        string    `json:"topologyId"`
}

type LabState int

const (
	Scheduled LabState = iota
	Deploying
	Running
	Failed
	Done
)

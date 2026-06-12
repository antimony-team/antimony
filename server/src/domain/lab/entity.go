package lab

import (
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
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
	CreatorID          uint   `gorm:"not null"`
	InstanceName       string `gorm:"uniqueIndex"`
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

type LabFilter struct {
	Limit            int        `form:"limit"`
	Offset           int        `form:"offset"`
	SearchQuery      *string    `form:"searchQuery"`
	StartDate        *time.Time `form:"startDate"`
	EndDate          *time.Time `form:"endDate"`
	StateFilter      []int      `form:"stateFilter[]"`
	CollectionFilter []string   `form:"collectionFilter[]"`
}

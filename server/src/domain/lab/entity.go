package lab

import (
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"time"

	"gorm.io/gorm"
)

type Lab struct {
	gorm.Model
	UUID string `gorm:"uniqueIndex;not null"`
	// Name is unique among the non-deleted labs of a collection.
	Name string `gorm:"index:idx_labs_collection_name,unique,where:deleted_at IS NULL;not null"`

	StartTime time.Time  `gorm:"index;not null"`
	EndTime   *time.Time `gorm:"index"`

	// Topology is the topology the lab was created from. The lab deploys its own copy of it, so the topology can
	// change afterward or be in a different collection than the lab.
	Topology   topology.Topology
	TopologyID uint `gorm:"not null"`

	// Collection is the collection the lab belongs to. It is the topology's collection at the time the lab was
	// created and decides who can access the lab.
	Collection   collection.Collection
	CollectionID uint `gorm:"index:idx_labs_collection_name,unique,where:deleted_at IS NULL;not null"`
	Creator      user.User
	CreatorID    uint   `gorm:"not null"`
	InstanceName string `gorm:"uniqueIndex"`

	// TopologyDefinition is the topology definition of the lab. It is the topology's definition at the time the
	// lab was created.
	TopologyDefinition *string
}

// LabIn is used to create a lab.
type LabIn struct {
	Name      *string    `json:"name"      binding:"required"`
	StartTime *time.Time `json:"startTime" binding:"required"`
	// EndTime is deliberately optional. A lab created without one runs indefinitely.
	EndTime    *time.Time `json:"endTime"`
	TopologyId *string    `json:"topologyId" binding:"required"`
}

// LabInPartial is used to update a lab.
type LabInPartial struct {
	Name      *string    `json:"name"`
	StartTime *time.Time `json:"startTime"`
	EndTime   *time.Time `json:"endTime"`

	// Indefinite is used to explicitly mark a lab as running indefinitely. As all fields in this struct are optional,
	// we can't rely on [LabInPartial.EndTime] being nil as marking the lab as running indefinitely.
	Indefinite *bool `json:"indefinite"`
}

// LabFilter represents a filter in a lab list request.
type LabFilter struct {
	Limit            int        `form:"limit"`
	Offset           int        `form:"offset"`
	SearchQuery      *string    `form:"searchQuery"`
	StartDate        *time.Time `form:"startDate"`
	EndDate          *time.Time `form:"endDate"`
	StateFilter      []int      `form:"stateFilter[]"`
	CollectionFilter []string   `form:"collectionFilter[]"`
}

package topology

import (
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/user"

	"gorm.io/gorm"
)

type Topology struct {
	gorm.Model
	UUID         string `gorm:"uniqueIndex;not null"`
	Name         string `gorm:"index;not null"`
	SyncUrl      string
	Collection   collection.Collection
	CollectionID uint `gorm:"not null"`
	Creator      user.User
	CreatorID    uint `gorm:"not null"`

	// LastDeployFailed Indicating if the last deployment of this topology was successful or not.
	//
	// This field is set to true whenever a lab referencing this topology fails to deploy and set to false whenever
	// the deployment succeeds.
	LastDeployFailed bool `gorm:"default:false;not null"`
}

type TopologyIn struct {
	Definition   *string `json:"definition"   binding:"required"`
	SyncUrl      *string `json:"syncUrl"      binding:"required"`
	CollectionId *string `json:"collectionId" binding:"required"`
}

type TopologyInPartial struct {
	Definition   *string `json:"definition"`
	SyncUrl      *string `json:"syncUrl"`
	CollectionId *string `json:"collectionId"`
}

type TopologyFull struct {
	ID               string
	Definition       string
	SyncUrl          string
	Collection       collection.Collection
	Creator          user.User
	BindFiles        []BindFileFull
	LastDeployFailed bool
}

type BindFile struct {
	gorm.Model
	UUID       string   `gorm:"uniqueIndex;not null"`
	FilePath   string   `gorm:"not null"`
	Topology   Topology `gorm:"not null"`
	TopologyID uint     `gorm:"not null"`
}

type BindFileFull struct {
	ID       string
	FilePath string
	Content  string
	Topology Topology
}

type BindFileIn struct {
	Content  *string `json:"content"  binding:"required"`
	FilePath *string `json:"filePath" binding:"required"`
}

type BindFileInPartial struct {
	Content  *string `json:"content"`
	FilePath *string `json:"filePath"`
}

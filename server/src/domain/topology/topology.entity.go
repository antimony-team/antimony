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
	Definition   string `json:"definition"`
	SyncUrl      string `json:"syncUrl"`
	CollectionId string `json:"collectionId" binding:"required"`
}

type TopologyOut struct {
	ID               string        `json:"id"`
	Definition       string        `json:"definition"`
	SyncUrl          string        `json:"syncUrl"`
	CollectionId     string        `json:"collectionId"`
	Creator          user.UserOut  `json:"creator"`
	BindFiles        []BindFileOut `json:"bindFiles"`
	LastDeployFailed bool          `json:"lastDeployFailed"`
}

type BindFile struct {
	gorm.Model
	UUID       string   `gorm:"uniqueIndex;not null"`
	FilePath   string   `gorm:"not null"`
	Topology   Topology `gorm:"not null"`
	TopologyID uint     `gorm:"not null"`
}

type BindFileIn struct {
	Content  string `json:"content"`
	FilePath string `json:"filePath" binding:"required"`
}

type BindFileOut struct {
	ID         string `json:"id"`
	Content    string `json:"content"`
	FilePath   string `json:"filePath"`
	TopologyId string `json:"topologyId"`
}

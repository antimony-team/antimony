package topology

import (
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/user"
	"gorm.io/gorm"
)

type Topology struct {
	gorm.Model
	UUID         string `gorm:"uniqueIndex;not null"`
	GitSourceUrl string
	Collection   collection.Collection
	CollectionID uint `gorm:"not null"`
	Creator      user.User
	CreatorID    uint `gorm:"not null"`
}

type TopologyIn struct {
	Definition   string `json:"definition" binding:"required"`
	Metadata     string `json:"metadata"`
	GitSourceUrl string `json:"gitSourceUrl"`
	CollectionId string `json:"collectionId" binding:"required"`
}

type TopologyOut struct {
	ID           string       `json:"id"`
	Definition   string       `json:"definition"`
	Metadata     string       `json:"metadata"`
	GitSourceUrl string       `json:"gitSourceUrl"`
	CollectionId string       `json:"collectionId"`
	Creator      user.UserOut `json:"creator"`
}

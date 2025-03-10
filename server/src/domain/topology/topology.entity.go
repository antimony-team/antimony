package topology

import (
	"antimonyBackend/src/domain/collection"
	"antimonyBackend/src/domain/user"
	"gorm.io/gorm"
)

type Topology struct {
	gorm.Model
	UUID         string `gorm:"unique"`
	GitSourceUrl string
	Collection   collection.Collection
	CollectionID uint
	Creator      user.User
	CreatorID    uint
}

type TopologyIn struct {
	Definition   string `json:"definition" binding:"required"`
	Metadata     string `json:"metadata" binding:"required"`
	GitSourceUrl string `json:"gitSourceUrl" binding:"required"`
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

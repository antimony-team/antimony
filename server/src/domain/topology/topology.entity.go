package topology

import (
	"antimonyBackend/src/domain/collection"
	"antimonyBackend/src/domain/user"
	"gorm.io/gorm"
)

type Topology struct {
	gorm.Model
	UUID         string
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
	UUID         string `json:"uuid"`
	Definition   string `json:"definition"`
	Metadata     string `json:"metadata"`
	GitSourceUrl string `json:"gitSourceUrl"`
	CollectionId string `json:"collectionId"`
	CreatorEmail string `json:"creatorEmail"`
}

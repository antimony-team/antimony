package collection

import (
	"antimonyBackend/src/domain/user"
	"gorm.io/gorm"
)

type Collection struct {
	gorm.Model
	UUID         string
	Name         string
	PublicEdit   bool
	PublicDeploy bool
	Creator      user.User
	CreatorID    uint
}

type CollectionIn struct {
	Name         string `json:"name" binding:"required"`
	PublicEdit   bool   `json:"publicEdit" binding:"required"`
	PublicDeploy bool   `json:"publicDeploy" binding:"required"`
}

type CollectionOut struct {
	UUID         string `json:"uuid"`
	Name         string `json:"name"`
	PublicEdit   bool   `json:"publicEdit"`
	PublicDeploy bool   `json:"publicDeploy"`
	CreatorEmail string `json:"creatorEmail"`
}

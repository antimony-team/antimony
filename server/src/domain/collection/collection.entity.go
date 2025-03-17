package collection

import (
	"antimonyBackend/domain/user"
	"gorm.io/gorm"
)

type Collection struct {
	gorm.Model
	UUID         string `gorm:"uniqueIndex;not null"`
	Name         string `gorm:"uniqueIndex;not null"`
	PublicWrite  bool
	PublicDeploy bool
	Creator      user.User
	CreatorID    uint `gorm:"not null"`
}

type CollectionIn struct {
	Name         string `json:"name"`
	PublicWrite  bool   `json:"publicWrite"`
	PublicDeploy bool   `json:"publicDeploy"`
}

type CollectionOut struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	PublicWrite  bool         `json:"publicWrite"`
	PublicDeploy bool         `json:"publicDeploy"`
	Creator      user.UserOut `json:"creator"`
}

package collection

import (
	"antimonyBackend/src/domain/user"
	"gorm.io/gorm"
)

type Collection struct {
	gorm.Model
	UUID         string `gorm:"index"`
	Name         string `gorm:"index"`
	PublicWrite  bool
	PublicDeploy bool
	Creator      user.User
	CreatorID    uint
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

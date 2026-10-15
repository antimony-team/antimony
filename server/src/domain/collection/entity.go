package collection

import (
	"antimonyBackend/domain/user"

	"gorm.io/gorm"
)

type Collection struct {
	gorm.Model
	UUID string `gorm:"uniqueIndex;not null"`
	// Name is only unique among the collections that still exist. Names of deleted collections can be reused.
	Name         string `gorm:"index:idx_collections_name,unique,where:deleted_at IS NULL;not null"`
	PublicWrite  bool
	PublicDeploy bool
	Creator      user.User
	CreatorID    uint `gorm:"not null"`
}

type CollectionIn struct {
	Name         *string `json:"name"         binding:"required"`
	PublicWrite  *bool   `json:"publicWrite"  binding:"required"`
	PublicDeploy *bool   `json:"publicDeploy" binding:"required"`
}

type CollectionInPartial struct {
	Name         *string `json:"name"`
	PublicWrite  *bool   `json:"publicWrite"`
	PublicDeploy *bool   `json:"publicDeploy"`
}

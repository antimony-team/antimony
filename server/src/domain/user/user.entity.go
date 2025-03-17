package user

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	UUID string `gorm:"uniqueIndex;not null"`
	Sub  string `gorm:"index;not null"`
	Name string `gorm:"not null"`
}

type UserOut struct {
	ID   string `json:"id"`
	Name string `json:"Name"`
}

type CredentialsIn struct {
	Username string `json:"username" ,binding:"required"`
	Password string `json:"password" ,binding:"required"`
}

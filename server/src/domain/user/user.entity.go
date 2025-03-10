package user

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	UUID string `gorm:"index"`
	Sub  string `gorm:"index"`
	Name string
}

type UserOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type CredentialsIn struct {
	Username string `json:"username" ,binding:"required"`
	Password string `json:"password" ,binding:"required"`
}

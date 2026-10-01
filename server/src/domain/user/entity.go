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

// CredentialsIn is the native login payload.
type CredentialsIn struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// NativeUserIn is the payload for creating a non-admin native user in development mode.
type NativeUserIn struct {
	Username    string   `json:"username"    binding:"required"`
	Password    string   `json:"password"    binding:"required"`
	Collections []string `json:"collections"`
}

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

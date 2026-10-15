package user

import (
	"gorm.io/gorm"

	"github.com/antimony-team/antimony-server/config"
)

type User struct {
	gorm.Model
	UUID string `gorm:"uniqueIndex;not null"`
	Sub  string `gorm:"index;not null"`
	Name string `gorm:"not null"`
}

// CredentialsIn is the native login payload the user supplies when logging in natively.
type CredentialsIn struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type DesktopTokenIn struct {
	Token string `json:"token" binding:"required"`
}

// AuthConfigOut is the response payload for the authentication config.
type AuthConfigOut struct {
	Methods []config.AuthMethod `json:"methods"`
}

// NativeUserIn is the payload for creating a non-admin native user.
//
// Disclaimer: This is only used for testing in development mode.
type NativeUserIn struct {
	Username    string   `json:"username"    binding:"required"`
	Password    string   `json:"password"    binding:"required"`
	Collections []string `json:"collections"`
}

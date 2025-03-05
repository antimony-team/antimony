package user

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	UUID    string
	OpenID  string
	Email   string
	IsAdmin bool
}

type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

const NativeUserID = "00000000-0000-0000-0000-00000000000"

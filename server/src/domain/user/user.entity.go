package user

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	OpenID  string
	Email   string
	IsAdmin bool
}

type Credentials struct {
	username string
	password string
}

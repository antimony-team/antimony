package transport

import (
	"github.com/antimony-team/antimony/server/src/domain/user"
)

type UserOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func UserToOut(user *user.User) UserOut {
	return UserOut{
		ID:   user.UUID,
		Name: user.Name,
	}
}

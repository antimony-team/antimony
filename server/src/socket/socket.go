package socket

import (
	"antimonyBackend/auth"

	"github.com/zishang520/socket.io/socket"
)

type ConnectedUser struct {
	*auth.AuthenticatedUser
	socket *socket.Socket
}

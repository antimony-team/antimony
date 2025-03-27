package socket

import (
	"antimonyBackend/auth"
	"github.com/zishang520/socket.io/socket"
)

type SocketConnectedUser struct {
	auth.AuthenticatedUser
	socket *socket.Socket
}

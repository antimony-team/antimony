package socket

import (
	"antimonyBackend/auth"

	"github.com/zishang520/socket.io/servers/socket/v3"
)

type ConnectedUser struct {
	*auth.AuthenticatedUser
	socket *socket.Socket
}

package socket

import (
	"github.com/zishang520/socket.io/servers/socket/v3"

	"github.com/antimony-team/antimony-server/auth"
)

type ConnectedUser struct {
	*auth.AuthenticatedUser
	socket *socket.Socket
}

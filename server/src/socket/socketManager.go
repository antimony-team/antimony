package socket

import (
	"antimonyBackend/auth"
	"github.com/charmbracelet/log"
	"github.com/zishang520/socket.io/socket"
)

type (
	SocketManager interface {
		Server() *socket.Server
		GetAuthUser(accessToken string) *auth.AuthenticatedUser
		SocketAuthenticatorMiddleware(s *socket.Socket, next func(*socket.ExtendedError))
	}

	socketManager struct {
		server      *socket.Server
		users       map[string]auth.AuthenticatedUser
		authManager auth.AuthManager
	}
)

func CreateSocketManager(authManager auth.AuthManager) SocketManager {
	server := socket.NewServer(nil, nil)

	manager := &socketManager{
		server:      server,
		users:       make(map[string]auth.AuthenticatedUser),
		authManager: authManager,
	}

	return manager
}

func (m *socketManager) GetAuthUser(accessToken string) *auth.AuthenticatedUser {
	if authUser, ok := m.users[accessToken]; ok {
		return &authUser
	}
	return nil
}

func (m *socketManager) Server() *socket.Server {
	return m.server
}

func (m *socketManager) SocketAuthenticatorMiddleware(s *socket.Socket, next func(*socket.ExtendedError)) {
	accessToken, ok := s.Handshake().Auth.(map[string]any)["token"].(string)
	if !ok {
		log.Errorf("Invalid socket connection. Ignoring.")
		next(socket.NewExtendedError("Unauthorized", nil))
		return
	}

	authUser, err := m.authManager.AuthenticateUser(accessToken)
	if err != nil {
		log.Errorf("Invalid socket connection. Ignoring.")
		next(socket.NewExtendedError("Invalid Token", nil))
		return
	}

	m.users[accessToken] = *authUser
	next(nil)
}

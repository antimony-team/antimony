package socket

import (
	"antimonyBackend/auth"
	"github.com/zishang520/socket.io/socket"
	"sync"
)

type (
	// SocketManager Represents a wrapper around the socket.io objects and also manages all authenticated users.
	SocketManager interface {
		// Server A reference to the underlying socket.io server.
		Server() *socket.Server

		// GetAuthUser Returns an auth user by access token. This can be used by namespace managers to identify
		// an authenticated user sending a message or connecting to a namespace for the first time.
		GetAuthUser(accessToken string) *auth.AuthenticatedUser

		// SocketAuthenticatorMiddleware A middleware function that can be used for authenticated namespaces.
		SocketAuthenticatorMiddleware(s *socket.Socket, next func(*socket.ExtendedError))
	}

	socketManager struct {
		server      *socket.Server
		users       map[string]auth.AuthenticatedUser
		usersMutex  *sync.Mutex
		authManager auth.AuthManager
	}
)

func CreateSocketManager(authManager auth.AuthManager) SocketManager {
	server := socket.NewServer(nil, nil)

	manager := &socketManager{
		server:      server,
		users:       make(map[string]auth.AuthenticatedUser),
		usersMutex:  &sync.Mutex{},
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
		next(socket.NewExtendedError("Unauthorized", nil))
		return
	}

	authUser, err := m.authManager.AuthenticateUser(accessToken)
	if err != nil {
		next(socket.NewExtendedError("Invalid Token", nil))
		return
	}

	m.usersMutex.Lock()
	m.users[accessToken] = *authUser
	m.usersMutex.Unlock()

	next(nil)
}

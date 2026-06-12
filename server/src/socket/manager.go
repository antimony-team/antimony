package socket

import (
	"antimonyBackend/auth"
	"sync"

	"github.com/samber/lo"
	socketio "github.com/zishang520/socket.io/socket"
)

// socket.Manager Represents a wrapper around the socket.io objects and also manages all authenticated users.
type Manager struct {
	server      *socketio.Server
	authManager *auth.Manager

	users      map[string]auth.AuthenticatedUser
	usersMutex sync.Mutex
}

func CreateManager(authManager *auth.Manager) *Manager {
	server := socketio.NewServer(nil, nil)

	manager := &Manager{
		server:      server,
		authManager: authManager,

		users:      make(map[string]auth.AuthenticatedUser),
		usersMutex: sync.Mutex{},
	}

	return manager
}

// GetAuthUser Returns an auth user by access token. This can be used by namespace managers to identify
// an authenticated user sending a message or connecting to a namespace for the first time.
func (m *Manager) GetAuthUser(accessToken string) *auth.AuthenticatedUser {
	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	if authUser, ok := m.users[accessToken]; ok {
		return &authUser
	}
	return nil
}

// Server A reference to the underlying socket.io server.
func (m *Manager) Server() *socketio.Server {
	return m.server
}

// SocketAuthenticatorMiddleware A middleware function that can be used for authenticated namespaces.
// Optionally, a group of users that have access to the namespace can be specified. If the list is nil,
// all authenticated users will have access to the namespace.
func (m *Manager) SocketAuthenticatorMiddleware(
	accessGroup *[]*auth.AuthenticatedUser,
) func(s *socketio.Socket, next func(*socketio.ExtendedError)) {
	return func(s *socketio.Socket, next func(*socketio.ExtendedError)) {
		accessToken := m.parseHandshake(s.Handshake())

		if accessToken == nil {
			next(socketio.NewExtendedError("Unauthorized", nil))
			return
		}

		authUser, err := m.authManager.AuthenticateUser(*accessToken)
		if err != nil {
			next(socketio.NewExtendedError("Invalid Token", nil))
			return
		}

		if accessGroup != nil {
			_, hasAccess := lo.Find(*accessGroup, func(accessUser *auth.AuthenticatedUser) bool {
				return authUser.UserId == accessUser.UserId
			})

			if !hasAccess {
				next(socketio.NewExtendedError("No Access", nil))
				return
			}
		}

		m.usersMutex.Lock()
		m.users[*accessToken] = *authUser
		m.usersMutex.Unlock()

		next(nil)
	}
}

func (m *Manager) parseHandshake(handshake *socketio.Handshake) *string {
	authMap, ok := handshake.Auth.(map[string]any)
	if !ok {
		return nil
	}

	accessToken, ok := authMap["token"].(string)
	if !ok {
		return nil
	}

	return &accessToken
}

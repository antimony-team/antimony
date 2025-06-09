package socket

import (
	"antimonyBackend/auth"
	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	socketio "github.com/zishang520/socket.io/socket"
	"sync"
)

type (
	// SocketManager Represents a wrapper around the socket.io objects and also manages all authenticated users.
	SocketManager interface {
		// Server A reference to the underlying socket.io server.
		Server() *socketio.Server

		// GetAuthUser Returns an auth user by access token. This can be used by namespace managers to identify
		// an authenticated user sending a message or connecting to a namespace for the first time.
		GetAuthUser(accessToken string) *auth.AuthenticatedUser

		// SocketAuthenticatorMiddleware A middleware function that can be used for authenticated namespaces.
		// Optionally, a group of users that have access to the namespace can be specified. If the list is nil,
		// all authenticated users will have access to the namespace.
		SocketAuthenticatorMiddleware(
			accessGroup *[]*auth.AuthenticatedUser,
		) func(s *socketio.Socket, next func(*socketio.ExtendedError))
	}

	socketManager struct {
		server      *socketio.Server
		users       map[string]auth.AuthenticatedUser
		usersMutex  *sync.Mutex
		authManager auth.AuthManager
	}
)

func CreateSocketManager(authManager auth.AuthManager) SocketManager {
	server := socketio.NewServer(nil, nil)

	manager := &socketManager{
		server:      server,
		users:       make(map[string]auth.AuthenticatedUser),
		usersMutex:  &sync.Mutex{},
		authManager: authManager,
	}

	return manager
}

func (m *socketManager) GetAuthUser(accessToken string) *auth.AuthenticatedUser {
	m.usersMutex.Lock()
	defer m.usersMutex.Unlock()

	if authUser, ok := m.users[accessToken]; ok {
		return &authUser
	}
	return nil
}

func (m *socketManager) Server() *socketio.Server {
	return m.server
}

func (m *socketManager) SocketAuthenticatorMiddleware(
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
				log.Infof("no access")
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

func (m *socketManager) parseHandshake(handshake *socketio.Handshake) *string {
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

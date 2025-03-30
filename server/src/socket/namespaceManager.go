package socket

import (
	"antimonyBackend/auth"
	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	"github.com/zishang520/socket.io/socket"
	"slices"
	"strings"
	"sync"
)

type (
	// NamespaceManager Manages the dataflow in a socket.io namespace and the clients that are subscribed to it.
	//
	// The namespace can either be anonymous or authenticated. If authenticated, subscribing requires the clients
	// to provide a valid access token which will be used to authenticate them via auth.AuthManager.
	NamespaceManager[T any] interface {
		// Send Sends a message to all connected clients. This works in authenticated and anonymous namespaces.
		Send(msg T)

		// SendTo Sends a message to a set of user IDs. This only works in authenticated namespaces.
		SendTo(msg T, receivers []string)

		// SendToAdmins Sends a message to all connected admins. This only works in authenticated namespaces.
		SendToAdmins(msg T)
	}

	namespaceManager[T any] struct {
		// A list of all connected clients, authenticated and anonymous clients
		connectedClients []*SocketConnectedUser

		// A map of all connected authenticated clients indexed by their user ID
		connectedClientsMap  map[string]*SocketConnectedUser
		connectedClientsLock *sync.Mutex

		// The backlog of previously sent messages
		backlog     []T
		backlogLock *sync.Mutex
		isAnonymous bool
		useBacklog  bool
	}
)

func CreateNamespace[T any](socketManager SocketManager, isAnonymous bool, useBacklog bool, namespacePath ...string) NamespaceManager[T] {
	backlog := make([]T, 0)
	manager := &namespaceManager[T]{
		connectedClients:     make([]*SocketConnectedUser, 0),
		connectedClientsMap:  make(map[string]*SocketConnectedUser),
		connectedClientsLock: &sync.Mutex{},
		backlog:              backlog,
		backlogLock:          &sync.Mutex{},
		isAnonymous:          isAnonymous,
		useBacklog:           useBacklog,
	}

	namespaceName := "/" + strings.Join(namespacePath, "/")
	namespace := socketManager.Server().Of(namespaceName, nil)

	if !isAnonymous {
		namespace.Use(socketManager.SocketAuthenticatorMiddleware)
	}

	_ = namespace.On("connection", func(clients ...any) {
		client := clients[0].(*socket.Socket)

		if !isAnonymous {
			var authUser *auth.AuthenticatedUser
			if accessToken, ok := client.Handshake().Auth.(map[string]any)["token"].(string); !ok {
				return
			} else if authUser = socketManager.GetAuthUser(accessToken); authUser == nil {
				// This is just for consistency, as non-authenticated users should never make it past the middleware
				return
			}

			socketClient := &SocketConnectedUser{
				AuthenticatedUser: authUser,
				socket:            client,
			}

			manager.connectedClientsLock.Lock()
			manager.connectedClients = append(manager.connectedClients, socketClient)
			manager.connectedClientsMap[authUser.UserId] = socketClient
			manager.connectedClientsLock.Unlock()

			_ = client.On("disconnect", func(clients ...any) {
				log.Info("User disconnected from socket namespace", "namespace", namespaceName, "user", authUser.UserId)

				manager.connectedClientsLock.Lock()
				if i := slices.Index(manager.connectedClients, socketClient); i > -1 {
					manager.connectedClients = append(manager.connectedClients[:i], manager.connectedClients[i+1:]...)
				}
				delete(manager.connectedClientsMap, authUser.UserId)
				manager.connectedClientsLock.Unlock()
			})

			log.Info("User connected to socket namespace", "namespace", namespaceName, "user", authUser.UserId)
		} else {
			socketClient := &SocketConnectedUser{
				socket: client,
			}

			manager.connectedClientsLock.Lock()
			manager.connectedClients = append(manager.connectedClients, socketClient)
			manager.connectedClientsLock.Unlock()

			_ = client.On("disconnect", func(clients ...any) {
				log.Info("Anonymous user disconnected from socket namespace", "namespace", namespaceName)

				if i := slices.Index(manager.connectedClients, socketClient); i > -1 {
					manager.connectedClientsLock.Lock()
					manager.connectedClients = append(manager.connectedClients[:i], manager.connectedClients[i+1:]...)
					manager.connectedClientsLock.Unlock()
				}
			})

			log.Info("Anonymous user connected to socket namespace", "namespace")
		}

		// Immediately send backlog to user if backlog is used in namespace
		if useBacklog {
			_ = client.Emit("backlog", manager.backlog)
		}
	})

	return manager
}

func (m *namespaceManager[T]) Send(msg T) {
	m.sendTo(msg, m.connectedClients)
}

func (m *namespaceManager[T]) SendTo(msg T, receivers []string) {
	if m.isAnonymous {
		log.Errorf("Server is trying to send an addressed socket message in an anonymous namespace. Aborting.")
		return
	}

	m.sendTo(msg, lo.FilterMap(receivers, func(userId string, _ int) (*SocketConnectedUser, bool) {
		if client, ok := m.connectedClientsMap[userId]; ok {
			return client, true
		}
		return nil, false
	}))
}

func (m *namespaceManager[T]) SendToAdmins(msg T) {
	if m.isAnonymous {
		log.Errorf("Server is trying to send an addressed socket message in an anonymous namespace. Aborting.")
		return
	}

	m.sendTo(msg, lo.Filter(m.connectedClients, func(client *SocketConnectedUser, _ int) bool {
		return client.IsAdmin
	}))
}

func (m *namespaceManager[T]) sendTo(msg T, receivers []*SocketConnectedUser) {
	if m.useBacklog {
		m.backlogLock.Lock()
		m.backlog = append(m.backlog, msg)
		m.backlogLock.Unlock()
	}

	for _, client := range receivers {
		if err := client.socket.Emit("data", msg); err != nil {
			log.Warnf("Failed to emit socket message to client : %s", err.Error())
		}
	}
}

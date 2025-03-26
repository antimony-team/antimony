package socket

import (
	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	"github.com/zishang520/socket.io/socket"
	"maps"
	"slices"
	"strings"
	"sync"
)

type (
	NamespaceManager[T any] interface {
		Send(msg T)
		SendTo(msg T, receivers []string)
		SendToAdmins(msg T)
	}

	namespaceManager[T any] struct {
		connectedClients map[string]*SocketConnectedUser
		lock             *sync.Mutex
		messages         []T
		anonymous        bool
	}
)

func CreateNamespace[T any](socketManager SocketManager, anonymous bool, namespacePath ...string) NamespaceManager[T] {
	messages := make([]T, 0)
	manager := &namespaceManager[T]{
		connectedClients: make(map[string]*SocketConnectedUser),
		messages:         messages,
		anonymous:        anonymous,
		lock:             &sync.Mutex{},
	}

	namespaceName := "/" + strings.Join(namespacePath, "/")
	namespace := socketManager.Server().Of(namespaceName, nil)

	if !anonymous {
		namespace.Use(socketManager.SocketAuthenticatorMiddleware)
	}

	namespace.On("connection", func(clients ...any) {
		client := clients[0].(*socket.Socket)
		accessToken, _ := client.Handshake().Auth.(map[string]any)["token"].(string)
		authUser := socketManager.GetAuthUser(accessToken)
		log.Info("User connected to socket namespace", "namespace", namespaceName, "user", accessToken)
		if authUser == nil {
			return
		}

		manager.lock.Lock()

		client.Emit("backlog", manager.messages)

		manager.lock.Unlock()

		log.Info("User connected to socket namespace", "namespace", namespaceName, "user", authUser.UserId)
		manager.connectedClients[authUser.UserId] = &SocketConnectedUser{
			AuthenticatedUser: *authUser,
			socket:            client,
		}

		client.On("disconnect", func(clients ...any) {
			log.Info("User disconnected from socket namespace", "namespace", namespaceName, "user", authUser.UserId)
			delete(manager.connectedClients, authUser.UserId)
		})
	})

	return manager
}

func (m *namespaceManager[T]) getMessages() *[]T {
	return &m.messages
}

func (m *namespaceManager[T]) Send(msg T) {
	m.sendTo(msg, lo.Filter(slices.Collect(maps.Values(m.connectedClients)), func(client *SocketConnectedUser, _ int) bool {
		return client.IsAdmin
	}))
}

func (m *namespaceManager[T]) SendTo(msg T, receivers []string) {
	if m.anonymous {
		log.Warnf("Server is trying to send addressed socket message in anonymous namespace. Aborting.")
		return
	}

	m.sendTo(msg, lo.FilterMap(receivers, func(userId string, _ int) (*SocketConnectedUser, bool) {
		if client, ok := m.connectedClients[userId]; ok {
			return client, true
		}
		return nil, false
	}))
}

func (m *namespaceManager[T]) SendToAdmins(msg T) {
	if m.anonymous {
		log.Warnf("Server is trying to send addressed socket message in anonymous namespace. Aborting.")
		return
	}

	m.sendTo(msg, lo.Filter(slices.Collect(maps.Values(m.connectedClients)), func(client *SocketConnectedUser, _ int) bool {
		return client.IsAdmin
	}))
}

func (m *namespaceManager[T]) sendTo(msg T, receivers []*SocketConnectedUser) {
	m.lock.Lock()
	m.messages = append(m.messages, msg)
	m.lock.Unlock()

	log.Infof("Sending %v to %v", msg, receivers)
	for _, client := range receivers {
		if err := client.socket.Emit("data", msg); err != nil {
			log.Warnf("Failed to emit socket message to client : %s", err.Error())
		}
	}
}

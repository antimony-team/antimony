package socket

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"context"
	"encoding/json"
	"slices"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	socketio "github.com/zishang520/socket.io/socket"
)

type (
	// IONamespace Manages the dataflow in a socket.io namespace and the clients that are subscribed to it.
	//
	// The namespace can either be anonymous or authenticated. If authenticated, subscribing requires the clients
	// to provide a valid access token which will be used to authenticate them via auth.AuthManager.
	IONamespace[I any, O any] interface {
		// Send Sends a message to all connected clients. This works in authenticated and anonymous namespaces.
		Send(msg O)

		// SendTo Sends a message to a set of user IDs. This only works in authenticated namespaces.
		SendTo(msg O, receivers []string)

		// SendToAdmins Sends a message to all connected admins. This only works in authenticated namespaces.
		SendToAdmins(msg O)

		// ClearBacklog Removes all messages from the backlog
		ClearBacklog()
	}

	InputNamespace[I any]  = IONamespace[I, any]
	OutputNamespace[O any] = IONamespace[any, O]

	namespaceManager[I any, O any] struct {
		// A list of all connected clients, authenticated and anonymous clients
		connectedClients []*SocketConnectedUser

		// A map of all connected authenticated clients indexed by their user ID
		connectedClientsMap   map[string]*SocketConnectedUser
		connectedClientsMutex sync.Mutex

		useRawInput   bool
		isAnonymous   bool
		socketManager SocketManager

		onData DataInputHandler[I]

		// The backlog of previously sent messages
		backlog      []O
		backlogMutex sync.Mutex
		useBacklog   bool

		namespaceName string
		namespace     socketio.NamespaceInterface
	}

	DataInputHandler[I any] func(
		ct context.Context,
		data *I,
		authUser *auth.AuthenticatedUser,
		onResponse func(response utils.OkResponse[any]),
		onError func(response utils.ErrorResponse),
	)
)

// CreateIONamespace Creates a new socket.io namespace for a given socket manager.
// The namespace can be anonymous, meaning that users don't need to authenticate themselves when connecting.
// In anonymous namespaces, NamespaceManager.SendTo and NamespaceManager.SendToAdmins aren't available.
//
// If a backlog is used, new clients will receive all previously sent messages via the 'backlog' event upon connecting.
//
// Optionally, one can provide a onData callback which is called whenever a client sends a 'data' event in the namespace.
// The namespace path will be concatenated with slashes to form the namespace name (e.g. [foo, bar] -> /foo/bar).
func CreateIONamespace[I any, O any](
	socketManager SocketManager,
	isAnonymous bool,
	useBacklog bool,
	onData DataInputHandler[I],
	accessGroup *[]*auth.AuthenticatedUser,
	namespacePath ...string,
) IONamespace[I, O] {
	var useRawInput bool

	var test any = *new(I)
	switch test.(type) {
	case string:
		useRawInput = true
	default:
		useRawInput = false
	}

	manager := &namespaceManager[I, O]{
		connectedClients:      make([]*SocketConnectedUser, 0),
		connectedClientsMap:   make(map[string]*SocketConnectedUser),
		connectedClientsMutex: sync.Mutex{},
		socketManager:         socketManager,
		backlog:               make([]O, 0),
		backlogMutex:          sync.Mutex{},
		onData:                onData,
		isAnonymous:           isAnonymous,
		useBacklog:            useBacklog,
		useRawInput:           useRawInput,
	}

	manager.namespaceName = "/" + strings.Join(namespacePath, "/")
	manager.namespace = socketManager.Server().Of(manager.namespaceName, nil)

	if !isAnonymous {
		manager.namespace.Use(socketManager.SocketAuthenticatorMiddleware(accessGroup))
	}

	_ = manager.namespace.On("connection", manager.handleConnection)

	return manager
}

func CreateInputNamespace[I any](
	socketManager SocketManager,
	isAnonymous bool,
	useBacklog bool,
	onData DataInputHandler[I],
	accessGroup *[]*auth.AuthenticatedUser,
	namespacePath ...string,
) InputNamespace[I] {
	return CreateIONamespace[I, any](socketManager, isAnonymous, useBacklog, onData, accessGroup, namespacePath...)
}

func CreateOutputNamespace[O any](
	socketManager SocketManager,
	isAnonymous bool,
	useBacklog bool,
	accessGroup *[]*auth.AuthenticatedUser,
	namespacePath ...string,
) OutputNamespace[O] {
	return CreateIONamespace[any, O](socketManager, isAnonymous, useBacklog, nil, accessGroup, namespacePath...)
}

func (m *namespaceManager[I, O]) ClearBacklog() {
	m.backlogMutex.Lock()
	m.backlog = make([]O, 0)
	m.backlogMutex.Unlock()
}

func (m *namespaceManager[I, O]) Send(msg O) {
	m.sendTo(msg, m.connectedClients)
}

func (m *namespaceManager[I, O]) SendTo(msg O, receivers []string) {
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

func (m *namespaceManager[I, O]) SendToAdmins(msg O) {
	if m.isAnonymous {
		log.Errorf("Server is trying to send an addressed socket message in an anonymous namespace. Aborting.")
		return
	}

	m.sendTo(msg, lo.Filter(m.connectedClients, func(client *SocketConnectedUser, _ int) bool {
		return client.IsAdmin
	}))
}

func (m *namespaceManager[I, O]) sendTo(msg O, receivers []*SocketConnectedUser) {
	if m.useBacklog {
		m.backlogMutex.Lock()
		m.backlog = append(m.backlog, msg)
		m.backlogMutex.Unlock()
	}

	for _, client := range receivers {
		if err := client.socket.Emit("data", msg); err != nil {
			log.Warnf("Failed to emit socket message to client : %s", err.Error())
		}
	}
}

func (m *namespaceManager[I, O]) handleConnection(clients ...any) {
	client, ok := clients[0].(*socketio.Socket)

	if !ok {
		log.Errorf("Received invalid connection: %+v", clients)
		return
	}

	if m.isAnonymous {
		socketClient := &SocketConnectedUser{
			AuthenticatedUser: nil,
			socket:            client,
		}

		m.connectedClientsMutex.Lock()
		m.connectedClients = append(m.connectedClients, socketClient)
		m.connectedClientsMutex.Unlock()

		_ = client.On("disconnect", func(clients ...any) {
			log.Info("Anonymous user disconnected from socket namespace", "namespace", m.namespaceName)

			if i := slices.Index(m.connectedClients, socketClient); i > -1 {
				m.connectedClientsMutex.Lock()
				m.connectedClients = append(m.connectedClients[:i], m.connectedClients[i+1:]...)
				m.connectedClientsMutex.Unlock()
			}
		})

		log.Info("Anonymous user connected to socket namespace", "namespace", m.namespaceName)
		return
	}

	var authUser *auth.AuthenticatedUser
	if accessToken, ok := client.Handshake().Auth.(map[string]any)["token"].(string); !ok {
		return
	} else if authUser = m.socketManager.GetAuthUser(accessToken); authUser == nil {
		// This is just for consistency, as non-authenticated users should never make it past the middleware
		return
	}

	socketClient := &SocketConnectedUser{
		AuthenticatedUser: authUser,
		socket:            client,
	}

	m.connectedClientsMutex.Lock()
	m.connectedClients = append(m.connectedClients, socketClient)
	m.connectedClientsMap[authUser.UserId] = socketClient
	m.connectedClientsMutex.Unlock()

	_ = client.On("data", func(raw ...any) {
		m.handleData(authUser, raw...)
	})

	_ = client.On("disconnect", func(clients ...any) {
		log.Info("User disconnected from socket namespace", "namespace", m.namespaceName, "user", authUser.UserId)

		m.connectedClientsMutex.Lock()
		if i := slices.Index(m.connectedClients, socketClient); i > -1 {
			m.connectedClients = append(m.connectedClients[:i], m.connectedClients[i+1:]...)
		}
		delete(m.connectedClientsMap, authUser.UserId)
		m.connectedClientsMutex.Unlock()
	})

	log.Info("User connected to socket namespace", "namespace", m.namespaceName, "user", authUser.UserId)

	// Immediately send backlog to user if backlog is used in namespace
	if m.useBacklog {
		_ = client.Emit("backlog", m.backlog)
	}
}

func (m *namespaceManager[I, O]) handleData(authUser *auth.AuthenticatedUser, raw ...any) {
	var (
		ok      bool
		ack     func([]any, error)
		dataRaw string
		data    I
	)

	if len(raw) > 1 {
		ack, ok = raw[1].(func([]any, error))
		if !ok {
			return
		}
	}

	if dataRaw, ok = raw[0].(string); !ok {
		return
	}

	if m.useRawInput {
		if data, ok = any(dataRaw).(I); !ok {
			return
		}
	} else {
		if err := json.Unmarshal([]byte(dataRaw), &data); err != nil {
			if ack != nil {
				errorResponse := utils.CreateSocketErrorResponse(utils.ErrInvalidSocketRequest)
				ack([]any{errorResponse}, nil)
			}
			return
		}
	}

	ctx := context.Background()

	if ack != nil {
		m.onData(ctx, &data, authUser,
			func(response utils.OkResponse[any]) {
				ack([]any{response}, nil)
			},
			func(errorResponse utils.ErrorResponse) {
				ack([]any{errorResponse}, nil)
			},
		)
	} else {
		m.onData(ctx, &data, authUser, nil, nil)
	}
}

package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"context"
	socket "github.com/zishang520/socket.io/v2/socket"
)

type mockLabRepo struct {
	CreateFunc func(ctx context.Context, lab *Lab) error
}

func (m *mockLabRepo) Create(ctx context.Context, l *Lab) error {
	return m.CreateFunc(ctx, l)
}
func (m *mockLabRepo) GetAll(_ *LabFilter) ([]Lab, error) {
	return nil, nil
}
func (m *mockLabRepo) GetByUuid(ctx context.Context, labId string) (*Lab, error) {
	return nil, nil
}
func (m *mockLabRepo) GetFromCollections(ctx context.Context, f LabFilter, names []string) ([]Lab, error) {
	return nil, nil
}
func (m *mockLabRepo) Update(ctx context.Context, lab *Lab) error {
	return nil
}
func (m *mockLabRepo) Delete(ctx context.Context, lab *Lab) error {
	return nil
}

type mockTopologyRepo struct {
	GetByUuidFunc func(ctx context.Context, uuid string) (*topology.Topology, error)
}

func (m *mockTopologyRepo) GetByUuid(ctx context.Context, uuid string) (*topology.Topology, error) {
	if m.GetByUuidFunc != nil {
		return m.GetByUuidFunc(ctx, uuid)
	}
	return nil, nil
}
func (m *mockTopologyRepo) Update(ctx context.Context, topo *topology.Topology) error {
	return nil
}
func (m *mockTopologyRepo) GetAll(ctx context.Context) ([]topology.Topology, error) {
	return []topology.Topology{}, nil
}
func (m *mockTopologyRepo) GetByName(ctx context.Context, topologyName string, collectionId string) ([]topology.Topology, error) {
	return []topology.Topology{}, nil
}
func (m *mockTopologyRepo) GetFromCollections(ctx context.Context, collectionNames []string) ([]topology.Topology, error) {
	return []topology.Topology{}, nil
}
func (m *mockTopologyRepo) Create(ctx context.Context, topology *topology.Topology) error {
	return nil
}
func (m *mockTopologyRepo) Delete(ctx context.Context, topology *topology.Topology) error {
	return nil
}
func (m *mockTopologyRepo) GetBindFileByUuid(ctx context.Context, bindFileId string) (*topology.BindFile, error) {
	return nil, nil
}
func (m *mockTopologyRepo) GetBindFileForTopology(ctx context.Context, topologyId string) (*[]topology.BindFile, error) {
	return &[]topology.BindFile{}, nil
}
func (m *mockTopologyRepo) CreateBindFile(ctx context.Context, bindFile *topology.BindFile) error {
	return nil
}
func (m *mockTopologyRepo) UpdateBindFile(ctx context.Context, bindFile *topology.BindFile) error {
	return nil
}
func (m *mockTopologyRepo) DeleteBindFile(ctx context.Context, bindFile *topology.BindFile) error {
	return nil
}
func (m *mockTopologyRepo) DoesBindFilePathExist(ctx context.Context, bindFilePath string, topologyId string) (bool, error) {
	return false, nil
}
func (m *mockTopologyRepo) BindFileToOut(bindFile topology.BindFile, content string) topology.BindFileOut {
	return topology.BindFileOut{}
}

type mockUserRepo struct {
	GetByUuidFunc func(ctx context.Context, uuid string) (*user.User, error)
	UserToOutFunc func(u user.User) user.UserOut
}

func (m *mockUserRepo) GetByUuid(ctx context.Context, uuid string) (*user.User, error) {
	return m.GetByUuidFunc(ctx, uuid)
}
func (m *mockUserRepo) UserToOut(u user.User) user.UserOut {
	return m.UserToOutFunc(u)
}
func (m *mockUserRepo) Create(ctx context.Context, u *user.User) error {
	return nil
}
func (m *mockUserRepo) Update(ctx context.Context, u *user.User) error {
	return nil
}
func (m *mockUserRepo) GetBySub(ctx context.Context, openId string) (*user.User, bool, error) {
	return nil, false, nil
}

type Namespace interface {
	On(event string, handler any) error
	Emit(event string, args ...any) error
	Use(middleware ...any)
}

type NamespaceProvider interface {
	Of(namespace string, handler any) Namespace
}

type SocketManager interface {
	Server() NamespaceProvider
	GetAuthUser(accessToken string) *auth.AuthenticatedUser
	SocketAuthenticatorMiddleware(s *socket.Socket, next func(*socket.ExtendedError))
}

type mockNamespace struct{}

func (m *mockNamespace) On(_ string, _ any) error      { return nil }
func (m *mockNamespace) Emit(_ string, _ ...any) error { return nil }
func (m *mockNamespace) Use(_ ...any)                  {}

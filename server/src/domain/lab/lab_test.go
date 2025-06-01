package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	antimonySocket "antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"context"
	"errors"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"sync"
	"testing"
	"time"
)

type mockNamespaceManager[T any] struct {
	mock.Mock
}

func (m *mockNamespaceManager[T]) Send(msg T) {
	m.Called(msg)
}
func (m *mockNamespaceManager[T]) SendTo(msg T, receivers []string) {
	m.Called(msg, receivers)
}
func (m *mockNamespaceManager[T]) SendToAdmins(msg T) {
	m.Called(msg)
}
func (m *mockNamespaceManager[T]) Broadcast(msg T) {
	m.Called(msg)
}
func (m *mockNamespaceManager[T]) Register(fn func(data T)) func() {
	m.Called(fn)
	return func() {}
}
func (m *mockNamespaceManager[T]) ClearBacklog() {
	m.Called()
}

type mockStorageManager struct {
	mock.Mock
}

func (m *mockStorageManager) WriteTopology(topologyId string, content string) error {
	panic("implement me")
}
func (m *mockStorageManager) ReadMetadata(topologyId string, content *string) error {
	panic("implement me")
}
func (m *mockStorageManager) WriteMetadata(topologyId string, content string) error {
	panic("implement me")
}
func (m *mockStorageManager) ReadBindFile(topologyId string, filePath string, content *string) error {
	panic("implement me")
}
func (m *mockStorageManager) WriteBindFile(topologyId string, filePath string, content string) error {
	panic("implement me")
}
func (m *mockStorageManager) DeleteBindFile(topologyId string, filePath string) error {
	panic("implement me")
}
func (m *mockStorageManager) GetRunTopologyFile(labUUID string) string {
	args := m.Called(labUUID)
	return args.String(0)
}
func (m *mockStorageManager) CreateRunEnvironment(topologyId string, labId string, topologyDefinition string, topologyFilePath *string) error {
	args := m.Called(topologyId, labId, topologyDefinition, topologyFilePath)
	return args.Error(0)
}
func (m *mockStorageManager) DeleteRunEnvironment(labId string) error {
	args := m.Called(labId)
	return args.Error(0)
}
func (m *mockStorageManager) ReadTopology(topologyId string, content *string) error {
	args := m.Called(topologyId, content)
	return args.Error(0)
}

type MockDeploymentProvider struct {
	mock.Mock
}

func (m *MockDeploymentProvider) Exec(ctx context.Context, topologyFile string, content string, onLog func(data string), onDone func(output *string, err error)) {
	panic("implement me")
}
func (m *MockDeploymentProvider) ExecOnNode(ctx context.Context, topologyFile string, content string, nodeName string, onLog func(data string), onDone func(output *string, err error)) {
	panic("implement me")
}
func (m *MockDeploymentProvider) Save(ctx context.Context, topologyFile string, onLog func(data string), onDone func(output *string, err error)) {
	panic("implement me")
}
func (m *MockDeploymentProvider) SaveOnNode(ctx context.Context, topologyFile string, nodeName string, onLog func(data string), onDone func(output *string, err error)) {
	panic("implement me")
}
func (m *MockDeploymentProvider) Deploy(ctx context.Context, topologyFile string, onLog func(string)) (*string, error) {
	args := m.Called(ctx, topologyFile, onLog)
	return args.Get(0).(*string), args.Error(1)
}
func (m *MockDeploymentProvider) Destroy(ctx context.Context, topologyFile string, onLog func(string)) (*string, error) {
	args := m.Called(ctx, topologyFile, onLog)

	var result *string
	if val := args.Get(0); val != nil {
		result = val.(*string)
	}
	return result, args.Error(1)
}
func (m *MockDeploymentProvider) Inspect(ctx context.Context, topologyFile string, onLog func(string)) (*deployment.InspectOutput, error) {
	args := m.Called(ctx, topologyFile, onLog)
	return args.Get(0).(*deployment.InspectOutput), args.Error(1)
}
func (m *MockDeploymentProvider) InspectAll(ctx context.Context) (*deployment.InspectOutput, error) {
	args := m.Called(ctx)
	return args.Get(0).(*deployment.InspectOutput), args.Error(1)
}
func (m *MockDeploymentProvider) Redeploy(ctx context.Context, topologyFile string, onLog func(string)) (*string, error) {
	args := m.Called(ctx, topologyFile, onLog)

	var result *string
	if val := args.Get(0); val != nil {
		result = val.(*string)
	}
	return result, args.Error(1)
}
func (m *MockDeploymentProvider) StreamContainerLogs(ctx context.Context, topologyFile string, containerID string, onLog func(string)) error {
	args := m.Called(ctx, topologyFile, containerID, onLog)
	return args.Error(0)
}

type mockLabRepo struct {
	mock.Mock
}

func (m *mockLabRepo) GetAll(labFilter *LabFilter) ([]Lab, error) {
	args := m.Called(labFilter)
	return args.Get(0).([]Lab), args.Error(1)
}
func (m *mockLabRepo) GetByUuid(ctx context.Context, labId string) (*Lab, error) {
	args := m.Called(ctx, labId)
	lab, _ := args.Get(0).(*Lab)
	return lab, args.Error(1)
}
func (m mockLabRepo) GetFromCollections(ctx context.Context, labFilter LabFilter, collectionNames []string) ([]Lab, error) {
	panic("implement me GetFromCollections")
}
func (m mockLabRepo) Create(ctx context.Context, lab *Lab) error {
	panic("implement me Create")
}
func (m *mockLabRepo) Update(ctx context.Context, lab *Lab) error {
	args := m.Called(ctx, lab)
	return args.Error(0)
}
func (m mockLabRepo) Delete(ctx context.Context, lab *Lab) error {
	panic("implement me Delete")
}

type mockStatusNamespace struct {
	mock.Mock
}

func (m *mockStatusNamespace) Send(msg statusMessage.StatusMessage) {
	m.Called(msg)
}
func (m *mockStatusNamespace) SendTo(msg statusMessage.StatusMessage, receivers []string) {
	m.Called(msg, receivers)
}
func (m *mockStatusNamespace) SendToAdmins(msg statusMessage.StatusMessage) {
	m.Called(msg)
}
func (m *mockStatusNamespace) ClearBacklog() {
	m.Called()
}

type mockStringNamespace struct {
	mock.Mock
}

func (m *mockStringNamespace) Send(msg string) {
	m.Called(msg)
}
func (m *mockStringNamespace) SendTo(msg string, receivers []string) {
	m.Called(msg, receivers)
}
func (m *mockStringNamespace) SendToAdmins(msg string) {
	m.Called(msg)
}
func (m *mockStringNamespace) Broadcast(msg string) {
	m.Called(msg)
}
func (m *mockStringNamespace) Register(fn func(data string)) func() {
	m.Called(fn)
	return func() {}
}
func (m *mockStringNamespace) ClearBacklog() {
	m.Called()
}

type mockTopologyRepo struct {
	mock.Mock
}

func (m *mockTopologyRepo) GetByName(ctx context.Context, topologyName string, collectionId string) ([]topology.Topology, error) {
	panic("implement me")
}
func (m *mockTopologyRepo) GetFromCollections(ctx context.Context, collectionNames []string) ([]topology.Topology, error) {
	panic("implement me")
}
func (m *mockTopologyRepo) Create(ctx context.Context, topology *topology.Topology) error {
	panic("implement me")
}
func (m *mockTopologyRepo) Delete(ctx context.Context, topology *topology.Topology) error {
	panic("implement me")
}
func (m *mockTopologyRepo) GetBindFileByUuid(ctx context.Context, bindFileId string) (*topology.BindFile, error) {
	panic("implement me")
}
func (m *mockTopologyRepo) GetBindFileForTopology(ctx context.Context, topologyId string) (*[]topology.BindFile, error) {
	panic("implement me")
}
func (m *mockTopologyRepo) CreateBindFile(ctx context.Context, bindFile *topology.BindFile) error {
	panic("implement me")
}
func (m *mockTopologyRepo) UpdateBindFile(ctx context.Context, bindFile *topology.BindFile) error {
	panic("implement me")
}
func (m *mockTopologyRepo) DeleteBindFile(ctx context.Context, bindFile *topology.BindFile) error {
	panic("implement me")
}
func (m *mockTopologyRepo) DoesBindFilePathExist(ctx context.Context, bindFilePath string, topologyId string, excludeString string) (bool, error) {
	panic("implement me")
}
func (m *mockTopologyRepo) BindFileToOut(bindFile topology.BindFile, content string) topology.BindFileOut {
	panic("implement me")
}
func (m *mockTopologyRepo) Update(ctx context.Context, topo *topology.Topology) error {
	args := m.Called(ctx, topo)
	return args.Error(0)
}
func (m *mockTopologyRepo) GetAll(ctx context.Context) ([]topology.Topology, error) { return nil, nil }
func (m *mockTopologyRepo) GetByUuid(ctx context.Context, topologyId string) (*topology.Topology, error) {
	return nil, nil
}

func TestRunScheduler_DeploysLab(t *testing.T) {
	mockLab := Lab{
		UUID:      "lab123",
		Name:      "Test Scheduled Lab",
		StartTime: time.Now().Add(-1 * time.Minute), // already due
		Topology:  topology.Topology{UUID: "topo1", Name: "TestTopo"},
		Creator:   user.User{UUID: "user123"},
	}

	storageManager := &mockStorageManager{}
	mockDeployment := &MockDeploymentProvider{}
	labRepo := &mockLabRepo{}
	topologyRepo := &mockTopologyRepo{}

	storageManager.On("CreateRunEnvironment", "topo1", "lab123", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			*args.Get(3).(*string) = "/tmp/fake.clab.yaml"
		}).Return(nil)
	storageManager.On("ReadTopology", "topo1", mock.Anything).
		Run(func(args mock.Arguments) {
			ptr := args.Get(1).(*string)
			*ptr = "name: TestTopo"
		}).Return(nil)
	labRepo.On("Update", mock.Anything, mock.Anything).Return(nil)
	mockDeployment.On("Deploy", mock.Anything, "/tmp/fake.clab.yaml", mock.Anything).
		Return(lo.ToPtr("success"), nil)
	topologyRepo.On("Update", mock.Anything, mock.Anything).Return(nil)
	mockDeployment.On("Inspect", mock.Anything, "/tmp/fake.clab.yaml", mock.Anything).
		Return(&deployment.InspectOutput{}, nil)

	svc := &labService{
		labRepo:                labRepo,
		storageManager:         storageManager,
		deploymentProvider:     mockDeployment,
		topologyRepo:           topologyRepo,
		socketManager:          antimonySocket.CreateSocketManager(nil),
		statusMessageNamespace: &fakeNamespace[statusMessage.StatusMessage]{},
		labUpdatesNamespace:    &fakeNamespace[string]{},
		scheduledLabs:          map[string]struct{}{"lab123": {}},
		labDeploySchedule:      []Lab{mockLab},
		instances:              map[string]*Instance{},
		labDeployScheduleMutex: sync.Mutex{},
	}

	go svc.RunScheduler()

	time.Sleep(6 * time.Second)

	svc.labDeployScheduleMutex.Lock()
	assert.Len(t, svc.labDeploySchedule, 0)
	_, stillScheduled := svc.scheduledLabs["lab123"]
	svc.labDeployScheduleMutex.Unlock()

	assert.False(t, stillScheduled, "Lab should have been removed from scheduled list")

	mockDeployment.AssertExpectations(t)
	storageManager.AssertExpectations(t)
}

func TestInitSchedule(t *testing.T) {
	type testCase struct {
		name           string
		mockLabs       []Lab
		mockContainers []deployment.InspectContainer
		mockLogError   error
		wantScheduled  bool
		wantInstances  bool
	}

	instanceName := "lab-instance"

	tests := []testCase{
		{
			name: "schedules future lab",
			mockLabs: []Lab{
				{
					UUID:      "lab1",
					Name:      "Future Lab",
					StartTime: time.Now().Add(10 * time.Minute),
					Topology:  topology.Topology{UUID: "topo1"},
					Creator:   user.User{UUID: "user1"},
				},
			},
			wantScheduled: true,
		},
		{
			name: "skips already deployed lab",
			mockLabs: []Lab{
				{
					UUID:         "lab2",
					Name:         "Deployed Lab",
					StartTime:    time.Now().Add(-10 * time.Minute),
					InstanceName: &instanceName,
				},
			},
			mockContainers: []deployment.InspectContainer{}, // no running container
			wantScheduled:  false,
		},
		{
			name: "restores running instance",
			mockLabs: []Lab{
				{
					UUID:         "lab3",
					Name:         "Running Lab",
					StartTime:    time.Now().Add(-5 * time.Minute),
					InstanceName: &instanceName,
					Topology:     topology.Topology{UUID: "topo3"},
					Creator:      user.User{UUID: "user3"},
				},
			},
			mockContainers: []deployment.InspectContainer{
				{LabName: instanceName, ContainerId: "c1", Name: "node1"},
			},
			wantInstances: true,
		},
		{
			name: "handles log stream failure",
			mockLabs: []Lab{
				{
					UUID:         "lab4",
					Name:         "Broken Lab",
					StartTime:    time.Now().Add(-5 * time.Minute),
					InstanceName: &instanceName,
					Topology:     topology.Topology{UUID: "topo4"},
					Creator:      user.User{UUID: "user4"},
				},
			},
			mockContainers: []deployment.InspectContainer{
				{LabName: instanceName, ContainerId: "c2", Name: "node2"},
			},
			mockLogError:  errors.New("stream failed"),
			wantInstances: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockLabRepo := &mockLabRepo{}
			mockDeployment := &MockDeploymentProvider{}
			mockStorage := &mockStorageManager{}

			// Setup expectations
			mockLabRepo.On("GetAll", mock.Anything).Return(tt.mockLabs, nil)
			mockDeployment.On("InspectAll", mock.Anything).Return(&deployment.InspectOutput{
				Containers: tt.mockContainers,
			}, nil)

			for _, c := range tt.mockContainers {
				mockDeployment.On("StreamContainerLogs", mock.Anything, "", c.ContainerId, mock.Anything).
					Return(tt.mockLogError)
			}

			mockStorage.On("GetRunTopologyFile", mock.Anything).Return("/tmp/fake.yaml")

			svc := &labService{
				labRepo:                mockLabRepo,
				storageManager:         mockStorage,
				deploymentProvider:     mockDeployment,
				socketManager:          antimonySocket.CreateSocketManager(nil),
				statusMessageNamespace: &fakeNamespace[statusMessage.StatusMessage]{},
				labUpdatesNamespace:    &fakeNamespace[string]{},
				scheduledLabs:          make(map[string]struct{}),
				labDeploySchedule:      []Lab{},
				instances:              make(map[string]*Instance),
				labDeployScheduleMutex: sync.Mutex{},
				deploymentMutex:        sync.Mutex{},
			}

			svc.reviveLabs()

			if tt.wantScheduled {
				assert.Len(t, svc.labDeploySchedule, 1)
				assert.Contains(t, svc.scheduledLabs, tt.mockLabs[0].UUID)
			} else {
				assert.Len(t, svc.labDeploySchedule, 0)
				assert.NotContains(t, svc.scheduledLabs, tt.mockLabs[0].UUID)
			}

			if tt.wantInstances {
				svc.deploymentMutex.Lock()
				_, ok := svc.instances[tt.mockLabs[0].UUID]
				svc.deploymentMutex.Unlock()
				assert.True(t, ok)
			} else {
				assert.Empty(t, svc.instances)
			}

			mockLabRepo.AssertExpectations(t)
			mockDeployment.AssertExpectations(t)
		})
	}
}

func TestRenameTopology(t *testing.T) {
	type fields struct {
		storageManager storage.StorageManager
	}
	type args struct {
		topologyId            string
		topologyName          string
		runTopologyDefinition *string
	}

	tests := []struct {
		name                 string
		fields               fields
		args                 args
		expectErr            bool
		expectOutputContains string
		expectOutputEmpty    bool
		mockSetup            func(*mockStorageManager)
	}{
		{
			name:              "fails on storage read error",
			expectErr:         true,
			expectOutputEmpty: true,
			fields:            fields{storageManager: &mockStorageManager{}},
			args: args{
				topologyId:            "topo1",
				topologyName:          "newName",
				runTopologyDefinition: new(string),
			},
			mockSetup: func(m *mockStorageManager) {
				m.On("ReadTopology", "topo1", mock.Anything).Return(errors.New("read error"))
			},
		},
		{
			name:              "fails on yaml unmarshal error",
			expectErr:         true,
			expectOutputEmpty: true,
			fields:            fields{storageManager: &mockStorageManager{}},
			args: args{
				topologyId:            "topo2",
				topologyName:          "newName",
				runTopologyDefinition: new(string),
			},
			mockSetup: func(m *mockStorageManager) {
				m.On("ReadTopology", "topo2", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "!!"
					}).
					Return(nil)
			},
		},
		{
			name:              "fails on yaml marshal error",
			expectErr:         true,
			expectOutputEmpty: true,
			fields:            fields{storageManager: &mockStorageManager{}},
			args: args{
				topologyId:            "topo3",
				topologyName:          "newName",
				runTopologyDefinition: new(string),
			},
			mockSetup: func(m *mockStorageManager) {
				m.On("ReadTopology", "topo3", mock.Anything).Run(func(args mock.Arguments) {
					ptr := args.Get(1).(*string)
					*ptr = "? !!map [1, 2]: someValue\n"
				}).Return(nil)
			},
		},
		{
			name:                 "successfully renames topology",
			expectErr:            false,
			expectOutputContains: "renamed-topo",
			fields:               fields{storageManager: &mockStorageManager{}},
			args: args{
				topologyId:            "topo4",
				topologyName:          "renamed-topo",
				runTopologyDefinition: new(string),
			},
			mockSetup: func(m *mockStorageManager) {
				m.On("ReadTopology", "topo4", mock.Anything).Run(func(args mock.Arguments) {
					ptr := args.Get(1).(*string)
					*ptr = "name: oldname"
				}).Return(nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSM := tt.fields.storageManager.(*mockStorageManager)
			tt.mockSetup(mockSM)

			svc := &labService{storageManager: mockSM}
			err := svc.renameTopology(tt.args.topologyId, tt.args.topologyName, tt.args.runTopologyDefinition)

			if tt.expectErr {
				assert.Error(t, err, tt.name)
			} else {
				assert.NoError(t, err, tt.name)
			}
			if tt.expectOutputEmpty {
				assert.Empty(t, *tt.args.runTopologyDefinition, tt.name)
			}
			if tt.expectOutputContains != "" {
				assert.Contains(t, *tt.args.runTopologyDefinition, tt.expectOutputContains, tt.name)
			}
		})
	}
}

func TestCreateLabEnvironment(t *testing.T) {
	type fields struct {
		labRepo        *mockLabRepo
		storageManager *mockStorageManager
	}
	type args struct {
		lab *Lab
	}
	tests := []struct {
		name           string
		setup          func(*fields, *args)
		wantErr        bool
		expectInstance bool
		expectTopology string
	}{
		{
			name: "successful environment creation",
			setup: func(f *fields, a *args) {
				a.lab = &Lab{
					UUID: "lab1",
					Topology: topology.Topology{
						UUID: "topo1",
						Name: "test-topo",
					},
				}
				f.storageManager.On("ReadTopology", "topo1", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "name: test-topo"
					}).Return(nil)

				f.storageManager.On("CreateRunEnvironment", "topo1", "lab1", mock.Anything, mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(3).(*string)
						*ptr = "/tmp/topology.clab.yaml"
					}).Return(nil)

				f.labRepo.On("Update", mock.Anything, mock.Anything).Return(nil)
			},
			wantErr:        false,
			expectInstance: true,
			expectTopology: "/tmp/topology.clab.yaml",
		},
		{
			name: "renameTopology fails on invalid YAML",
			setup: func(f *fields, a *args) {
				a.lab = &Lab{
					UUID: "lab1",
					Topology: topology.Topology{
						UUID: "bad-topo",
						Name: "test-topo",
					},
				}
				f.storageManager.On("ReadTopology", "bad-topo", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "!!"
					}).Return(nil)
			},
			wantErr: true,
		},
		{
			name: "CreateRunEnvironment fails",
			setup: func(f *fields, a *args) {
				a.lab = &Lab{
					UUID: "lab1",
					Topology: topology.Topology{
						UUID: "topo2",
						Name: "test-topo",
					},
				}
				f.storageManager.On("ReadTopology", "topo2", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "name: test-topo"
					}).Return(nil)

				f.storageManager.On("CreateRunEnvironment", "topo2", "lab1", mock.Anything, mock.Anything).
					Return(errors.New("failed to create run env"))
			},
			wantErr: true,
		},
		{
			name: "labRepo.Update fails",
			setup: func(f *fields, a *args) {
				a.lab = &Lab{
					UUID: "lab1",
					Topology: topology.Topology{
						UUID: "topo3",
						Name: "test-topo",
					},
				}
				f.storageManager.On("ReadTopology", "topo3", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "name: test-topo"
					}).Return(nil)

				f.storageManager.On("CreateRunEnvironment", "topo3", "lab1", mock.Anything, mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(3).(*string)
						*ptr = "/tmp/topology.clab.yaml"
					}).Return(nil)

				f.labRepo.On("Update", mock.Anything, mock.Anything).Return(errors.New("update failed"))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fields := fields{
				labRepo:        &mockLabRepo{},
				storageManager: &mockStorageManager{},
			}
			args := &args{}
			tt.setup(&fields, args)

			svc := &labService{
				labRepo:        fields.labRepo,
				storageManager: fields.storageManager,
			}

			runFile, err := svc.createLabEnvironment(context.Background(), args.lab)

			if tt.wantErr {
				assert.Error(t, err, tt.name)
			} else {
				assert.NoError(t, err, tt.name)
				assert.Equal(t, tt.expectTopology, runFile, "Topology file should match expected output")
				if tt.expectInstance {
					assert.NotNil(t, args.lab.InstanceName, "lab.InstanceName should be set")
				}
			}
		})
	}
}

func TestDestroyLab(t *testing.T) {
	type fields struct {
		deploymentProvider *MockDeploymentProvider
		statusNamespace    *mockStatusNamespace
		storageManager     *mockStorageManager
	}
	type args struct {
		lab      Lab
		instance *Instance
	}

	tests := []struct {
		name      string
		setup     func(*fields, *args)
		assertion func(f *fields)
	}{
		{
			name: "successful destroy",
			setup: func(f *fields, a *args) {
				f.statusNamespace = &mockStatusNamespace{}
				f.statusNamespace.On("Send", mock.Anything).Maybe()

				f.deploymentProvider = &MockDeploymentProvider{}
				f.deploymentProvider.On("Destroy", mock.Anything, "file.yaml", mock.Anything).Return(lo.ToPtr("destroyed"), nil)

				f.storageManager = &mockStorageManager{}
				f.storageManager.On("DeleteRunEnvironment", "lab1").Return(nil)

				logNs := &mockNamespaceManager[string]{}
				logNs.On("Send", mock.Anything).Maybe()
				logNs.On("ClearBacklog").Return()

				a.lab = Lab{
					UUID:         "lab1",
					Name:         "TestLab",
					Topology:     topology.Topology{Name: "Topo"},
					InstanceName: lo.ToPtr("test-instance"),
				}

				a.instance = &Instance{
					TopologyFile: "file.yaml",
					LogNamespace: logNs,
					Mutex:        sync.Mutex{},
				}
			},
			assertion: func(f *fields) {
				f.statusNamespace.AssertCalled(t, "Send", mock.Anything)
				f.deploymentProvider.AssertExpectations(t)
				f.storageManager.AssertExpectations(t)
			},
		},
		{
			name: "deployment destroy fails",
			setup: func(f *fields, a *args) {
				f.statusNamespace = &mockStatusNamespace{}
				f.statusNamespace.On("Send", mock.Anything).Maybe()

				f.deploymentProvider = &MockDeploymentProvider{}
				f.deploymentProvider.On("Destroy", mock.Anything, "file.yaml", mock.Anything).Return(nil, errors.New("destroy failed"))

				f.storageManager = &mockStorageManager{} // should NOT be called

				logNs := &mockNamespaceManager[string]{}
				logNs.On("Send", mock.Anything).Maybe()

				a.lab = Lab{
					UUID:         "lab2",
					Name:         "FailLab",
					Topology:     topology.Topology{Name: "FailTopo"},
					InstanceName: lo.ToPtr("fail-instance"),
				}

				a.instance = &Instance{
					TopologyFile: "file.yaml",
					LogNamespace: logNs,
					Mutex:        sync.Mutex{},
				}
			},
			assertion: func(f *fields) {
				f.statusNamespace.AssertCalled(t, "Send", mock.Anything)
				f.deploymentProvider.AssertExpectations(t)
				f.storageManager.AssertNotCalled(t, "DeleteRunEnvironment", mock.Anything)
			},
		},
		{
			name: "delete run environment fails",
			setup: func(f *fields, a *args) {
				f.statusNamespace = &mockStatusNamespace{}
				f.statusNamespace.On("Send", mock.Anything).Maybe()

				f.deploymentProvider = &MockDeploymentProvider{}
				f.deploymentProvider.On("Destroy", mock.Anything, "file.yaml", mock.Anything).Return(lo.ToPtr("destroyed"), nil)

				f.storageManager = &mockStorageManager{}
				f.storageManager.On("DeleteRunEnvironment", "lab3").Return(errors.New("fs error"))

				logNs := &mockNamespaceManager[string]{}
				logNs.On("Send", mock.Anything).Maybe()
				logNs.On("ClearBacklog").Return()

				a.lab = Lab{
					UUID:         "lab3",
					Name:         "WarnLab",
					Topology:     topology.Topology{Name: "WarnTopo"},
					InstanceName: lo.ToPtr("warn-instance"),
				}

				a.instance = &Instance{
					TopologyFile: "file.yaml",
					LogNamespace: logNs,
					Mutex:        sync.Mutex{},
				}
			},
			assertion: func(f *fields) {
				f.statusNamespace.AssertCalled(t, "Send", mock.Anything)
				f.storageManager.AssertExpectations(t)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fields{}
			a := &args{}
			tt.setup(f, a)

			mockLabUpdatesNs := &mockStringNamespace{}
			mockLabUpdatesNs.On("Send", mock.Anything).Maybe()

			svc := &labService{
				deploymentProvider:     f.deploymentProvider,
				statusMessageNamespace: f.statusNamespace,
				storageManager:         f.storageManager,
				labUpdatesNamespace:    mockLabUpdatesNs,
				instances:              map[string]*Instance{a.lab.UUID: a.instance},
			}

			// Call function
			svc.destroyLab(a.lab, a.instance)

			// Perform general assertions per test
			tt.assertion(f)

			switch tt.name {
			case "successful destroy":
				_, exists := svc.instances[a.lab.UUID]
				assert.False(t, exists, "Instance should be deleted after successful destroy")
			case "deployment destroy fails":
				_, exists := svc.instances[a.lab.UUID]
				assert.True(t, exists, "Instance should remain if destroy fails")
			case "delete run environment fails":
				_, exists := svc.instances[a.lab.UUID]
				assert.False(t, exists, "Instance should still be removed even if cleanup fails")
			}
		})
	}
}

func TestRedeployLab(t *testing.T) {
	type fields struct {
		deploymentProvider *MockDeploymentProvider
		statusNamespace    *mockStatusNamespace
	}
	type args struct {
		lab      Lab
		instance *Instance
	}

	tests := []struct {
		name     string
		setup    func(*fields, *args)
		want     bool
		wantFail bool
	}{
		{
			name: "returns false when already deploying",
			setup: func(f *fields, a *args) {
				f.statusNamespace = &mockStatusNamespace{}
				f.statusNamespace.On("Send", mock.Anything).Maybe()

				a.lab = Lab{UUID: "lab1"}
				a.instance = &Instance{State: InstanceStates.Deploying}
			},
			want: false,
		},
		{
			name: "successful redeploy",
			setup: func(f *fields, a *args) {
				f.statusNamespace = &mockStatusNamespace{}
				f.statusNamespace.On("Send", mock.Anything).Maybe()

				a.lab = Lab{
					UUID:         "lab2",
					Name:         "LabTwo",
					Topology:     topology.Topology{UUID: "topo1", Name: "TopoOne"},
					InstanceName: lo.ToPtr("lab2-instance"),
				}

				logNs := &mockNamespaceManager[string]{}
				logNs.On("Send", mock.Anything).Maybe()

				a.instance = &Instance{
					TopologyFile: "file.yaml",
					LogNamespace: logNs,
					Mutex:        sync.Mutex{},
					State:        InstanceStates.Running,
				}

				f.deploymentProvider.On("Redeploy", mock.Anything, "file.yaml", mock.Anything).
					Return(lo.ToPtr("output"), nil)
			},
			want: true,
		},
		{
			name: "redeploy fails",
			setup: func(f *fields, a *args) {
				f.statusNamespace = &mockStatusNamespace{}
				f.statusNamespace.On("Send", mock.Anything).Maybe()

				a.lab = Lab{
					UUID:         "lab3",
					Name:         "LabThree",
					Topology:     topology.Topology{UUID: "topo3", Name: "TopoThree"},
					InstanceName: lo.ToPtr("lab3-instance"),
				}

				logNs := &mockNamespaceManager[string]{}
				logNs.On("Send", mock.Anything).Maybe()

				a.instance = &Instance{
					TopologyFile: "broken.yaml",
					LogNamespace: logNs,
					Mutex:        sync.Mutex{},
					State:        InstanceStates.Running,
				}

				f.deploymentProvider.On("Redeploy", mock.Anything, "broken.yaml", mock.Anything).
					Run(func(args mock.Arguments) {
						// simulate a log callback
						if fn, ok := args.Get(2).(func(string)); ok && fn != nil {
							fn("mock log")
						}
					}).
					Return(nil, errors.New("redeploy failed"))
			},
			want:     true,
			wantFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			deploymentProvider := &MockDeploymentProvider{}
			f := &fields{
				deploymentProvider: deploymentProvider,
			}
			a := &args{}
			tt.setup(f, a)

			mockLabUpdatesNs := &mockStringNamespace{}
			mockLabUpdatesNs.On("Send", mock.Anything).Maybe()

			svc := &labService{
				deploymentProvider:     f.deploymentProvider,
				statusMessageNamespace: f.statusNamespace,
				labUpdatesNamespace:    mockLabUpdatesNs,
			}
			svc.instances = map[string]*Instance{
				a.lab.UUID: a.instance,
			}

			ok := svc.redeployLab(a.lab, a.instance)

			assert.Equal(t, tt.want, ok, tt.name)

			switch tt.name {
			case "returns false when already deploying":
				assert.Equal(t, InstanceStates.Deploying, a.instance.State, "State should remain Deploying")
			case "successful redeploy":
				assert.Equal(t, InstanceStates.Running, a.instance.State, "State should return to Running after success")
				f.statusNamespace.AssertCalled(t, "Send", mock.Anything)
			case "redeploy fails":
				assert.Equal(t, InstanceStates.Failed, a.instance.State, "State should change to Failed on error")
				f.statusNamespace.AssertCalled(t, "Send", mock.Anything)
			}
		})
	}
}

func TestDeployLab(t *testing.T) {
	type fields struct {
		deploymentProvider *MockDeploymentProvider
		statusNamespace    *mockStatusNamespace
		storageManager     *mockStorageManager
		socketManager      antimonySocket.SocketManager
	}
	type args struct {
		lab Lab
	}

	realSocketManager := antimonySocket.CreateSocketManager(nil)

	tests := []struct {
		name  string
		setup func(f *fields, a *args)
		want  bool
	}{
		{
			name: "instance already exists",
			setup: func(f *fields, a *args) {
				a.lab = Lab{UUID: "lab-exists"}
			},
			want: false,
		},
		{
			name: "createLabEnvironment fails",
			setup: func(f *fields, a *args) {
				a.lab = Lab{
					UUID:         "lab-env-fail",
					Name:         "LabEnvFail",
					Topology:     topology.Topology{UUID: "topo1", Name: "TopoFail"},
					InstanceName: lo.ToPtr("envfail"),
				}
				f.storageManager.On("ReadTopology", "topo1", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "!!"
					}).Return(nil)
			},
			want: true,
		},
		{
			name: "deploy fails",
			setup: func(f *fields, a *args) {
				a.lab = Lab{
					UUID:         "lab-deploy-fail",
					Name:         "LabDeployFail",
					Topology:     topology.Topology{UUID: "topo2", Name: "TopoDeploy"},
					InstanceName: lo.ToPtr("deployfail"),
				}
				f.storageManager.On("ReadTopology", "topo2", mock.Anything).
					Run(func(args mock.Arguments) {
						ptr := args.Get(1).(*string)
						*ptr = "name: TopoDeploy"
					}).Return(nil)
				f.storageManager.On("CreateRunEnvironment", "topo2", "lab-deploy-fail", mock.Anything, mock.Anything).
					Run(func(args mock.Arguments) {
						*args.Get(3).(*string) = "deploy.yaml"
					}).Return(nil)
				f.deploymentProvider.On("Deploy", mock.Anything, "deploy.yaml", mock.Anything).
					Return(lo.ToPtr(""), errors.New("failed to deploy"))
			},
			want: true,
		},
		{
			name: "successful deploy",
			setup: func(f *fields, a *args) {
				a.lab = Lab{
					UUID:         "lab-ok",
					Name:         "LabOK",
					Topology:     topology.Topology{UUID: "topo4", Name: "TopoOK"},
					InstanceName: lo.ToPtr("ok"),
				}
				f.storageManager.On("ReadTopology", "topo4", mock.Anything).
					Return(nil).Run(func(args mock.Arguments) {
					*args.Get(1).(*string) = "name: TopoOK"
				})
				f.storageManager.On("CreateRunEnvironment", "topo4", "lab-ok", mock.Anything, mock.Anything).
					Run(func(args mock.Arguments) {
						*args.Get(3).(*string) = "ok.yaml"
					}).Return(nil)
				f.deploymentProvider.On("Deploy", mock.Anything, "ok.yaml", mock.Anything).
					Return(lo.ToPtr("output"), nil)
				f.deploymentProvider.On("Inspect", mock.Anything, "ok.yaml", mock.Anything).
					Return(&deployment.InspectOutput{Containers: []deployment.InspectContainer{}}, nil)
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dp := &MockDeploymentProvider{}
			sm := &mockStorageManager{}
			sn := &mockStatusNamespace{}
			mockLabUpdatesNs := &mockStringNamespace{}
			labRepo := &mockLabRepo{}
			topoRepo := &mockTopologyRepo{}

			// Mocks
			labRepo.On("Update", mock.Anything, mock.Anything).Return(nil)
			topoRepo.On("Update", mock.Anything, mock.Anything).Return(nil)
			mockLabUpdatesNs.On("Send", mock.Anything).Maybe()
			sn.On("Send", mock.Anything).Maybe()

			f := &fields{
				deploymentProvider: dp,
				statusNamespace:    sn,
				storageManager:     sm,
				socketManager:      realSocketManager,
			}
			a := &args{}
			tt.setup(f, a)

			svc := &labService{
				deploymentProvider:     f.deploymentProvider,
				storageManager:         f.storageManager,
				statusMessageNamespace: f.statusNamespace,
				labUpdatesNamespace:    mockLabUpdatesNs,
				socketManager:          f.socketManager,
				labRepo:                labRepo,
				topologyRepo:           topoRepo,
				instances:              make(map[string]*Instance),
			}

			if tt.name == "instance already exists" {
				svc.instances[a.lab.UUID] = &Instance{}
			}

			got := svc.deployLab(a.lab)
			assert.Equal(t, tt.want, got, "Unexpected return from deployLab")

			switch tt.name {
			case "instance already exists":
				assert.Len(t, svc.instances, 1, "Instance should not be redeployed")

			case "createLabEnvironment fails":
				assert.Contains(t, svc.instances, a.lab.UUID)
				assert.Equal(t, InstanceStates.Failed, svc.instances[a.lab.UUID].State)
				sn.AssertCalled(t, "Send", mock.Anything)

			case "deploy fails":
				assert.Contains(t, svc.instances, a.lab.UUID)
				instance := svc.instances[a.lab.UUID]
				assert.NotNil(t, instance)
				assert.Equal(t, InstanceStates.Failed, instance.State)
				sn.AssertCalled(t, "Send", mock.Anything)

			case "successful deploy":
				assert.Contains(t, svc.instances, a.lab.UUID)
				instance := svc.instances[a.lab.UUID]
				assert.NotNil(t, instance)
				assert.Equal(t, InstanceStates.Running, instance.State)
				assert.Equal(t, "ok.yaml", instance.TopologyFile)
				sn.AssertCalled(t, "Send", mock.Anything)
			}
		})
	}
}

func TestInstanceToOut(t *testing.T) {
	svc := &labService{}

	t.Run("returns nil when input is nil", func(t *testing.T) {
		result := svc.instanceToOut(nil)
		assert.Nil(t, result)
	})

	t.Run("returns correct InstanceOut when input is valid", func(t *testing.T) {
		instance := &Instance{
			Deployed:          time.Now(),
			EdgesharkLink:     "http://edgeshark",
			State:             InstanceStates.Running,
			LatestStateChange: time.Now(),
			Nodes:             []InstanceNode{{Name: "node1"}},
			Recovered:         true,
		}
		result := svc.instanceToOut(instance)
		assert.NotNil(t, result)
		assert.Equal(t, instance.EdgesharkLink, result.EdgesharkLink)
		assert.Equal(t, instance.State, result.State)
		assert.Equal(t, instance.Recovered, result.Recovered)
	})
}

func TestContainerToInstanceNode(t *testing.T) {
	svc := &labService{}
	container := deployment.InspectContainer{
		Name:        "lab-node1",
		IPv4Address: "192.168.1.1",
		IPv6Address: "fe80::1",
		State:       deployment.NodeStates.Running,
		ContainerId: "abc123",
	}

	node := svc.containerToInstanceNode(container, 0)

	assert.Equal(t, "node1", node.Name)
	assert.Equal(t, "192.168.1.1", node.IPv4)
	assert.Equal(t, "fe80::1", node.IPv6)
	assert.Equal(t, deployment.NodeStates.Running, node.State) // Correct assertion
	assert.Equal(t, "abc123", node.ContainerId)
	assert.Equal(t, "lab-node1", node.ContainerName)
	assert.Equal(t, "ins", node.User)
	assert.Equal(t, 50005, node.Port)
}

func TestNotifyUpdate(t *testing.T) {
	mockStatusNs := &mockStatusNamespace{}
	mockLabNs := &mockStringNamespace{}

	svc := &labService{
		statusMessageNamespace: mockStatusNs,
		labUpdatesNamespace:    mockLabNs,
	}

	lab := Lab{UUID: "lab123"}
	msg := statusMessage.Info("test", "body", "summary")

	mockStatusNs.On("Send", mock.Anything).Once()
	mockLabNs.On("Send", "lab123").Once()

	svc.notifyUpdate(lab, msg)

	mockStatusNs.AssertExpectations(t)
	mockLabNs.AssertExpectations(t)
}

type fakeNamespace[T any] struct{}

func (n *fakeNamespace[T]) Send(msg T)                       {}
func (n *fakeNamespace[T]) SendTo(msg T, receivers []string) {}
func (n *fakeNamespace[T]) SendToAdmins(msg T)               {}
func (n *fakeNamespace[T]) ClearBacklog()                    {}

func TestHandleLabCommand(t *testing.T) {
	type fields struct {
		labRepo        *mockLabRepo
		storageManager *mockStorageManager
		deployment     *MockDeploymentProvider
		socketManager  antimonySocket.SocketManager
	}
	type args struct {
		cmd      LabCommand
		labId    string
		authUser *auth.AuthenticatedUser
		Node     *string
	}

	realSocketManager := antimonySocket.CreateSocketManager(nil)

	tests := []struct {
		name      string
		setup     func(f *fields, a *args)
		expectOK  bool
		expectErr bool
	}{
		{
			name: "redeploy success",
			setup: func(f *fields, a *args) {
				a.cmd = deployCommand
				a.labId = "lab12"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}

				lab := &Lab{
					UUID:    "lab12",
					Name:    "Test Lab",
					Creator: user.User{UUID: "user123"},
					Topology: topology.Topology{
						UUID: "topo1",
						Name: "TestTopo",
					},
					InstanceName: lo.ToPtr("lab12-instance"),
				}

				f.labRepo.On("GetByUuid", mock.Anything, "lab12").Return(lab, nil)
				f.labRepo.On("Update", mock.Anything, mock.Anything).Return(nil)

				f.deployment.On("Redeploy",
					mock.Anything, // context
					"/tmp/topology.clab.yaml",
					mock.MatchedBy(func(fn interface{}) bool {
						_, ok := fn.(func(string))
						return ok
					}),
				).Return(lo.ToPtr("redeploy-success"), nil)
				f.storageManager.On("ReadTopology", "topo1", mock.Anything).
					Run(func(args mock.Arguments) {
						*args.Get(1).(*string) = "name: TestTopo"
					}).Return(nil)

				f.storageManager.On("CreateRunEnvironment", "topo1", "lab12", mock.Anything, mock.Anything).
					Run(func(args mock.Arguments) {
						*args.Get(3).(*string) = "/tmp/topology.clab.yaml"
					}).Return(nil)

				f.deployment.On("Inspect", mock.Anything, "/tmp/topology.clab.yaml", mock.Anything).
					Return(&deployment.InspectOutput{}, nil)
			},
			expectOK:  true,
			expectErr: false,
		},
		{
			name: "deploy command returns error",
			setup: func(f *fields, a *args) {
				a.cmd = deployCommand
				a.labId = "lab-error"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}

				f.labRepo.On("GetByUuid", mock.Anything, "lab-error").
					Return(nil, errors.New("failed to get lab"))
			},
			expectOK:  false,
			expectErr: true,
		},
		{
			name: "destroy command succeeds",
			setup: func(f *fields, a *args) {
				a.cmd = destroyCommand
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}

				lab := &Lab{
					UUID:    "lab123",
					Name:    "Test Lab",
					Creator: user.User{UUID: "user123"},
					Topology: topology.Topology{
						Name: "TestTopo",
					},
					InstanceName: lo.ToPtr("testInstance"),
				}

				f.labRepo.On("GetByUuid", mock.Anything, "lab123").Return(lab, nil)
				f.storageManager.On("DeleteRunEnvironment", "lab123").Return(nil)
				f.deployment.On("Destroy", mock.Anything, mock.AnythingOfType("string"), mock.Anything).
					Return(nil, nil)
				a.Node = nil
			},
			expectOK:  true,
			expectErr: false,
		},
		{
			name: "destroy command fails when lab has no instance",
			setup: func(f *fields, a *args) {
				a.cmd = destroyCommand
				a.labId = "lab-no-instance"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}

				lab := &Lab{
					UUID:    "lab-no-instance",
					Name:    "Test Lab Without Instance",
					Creator: user.User{UUID: "user123"},
					Topology: topology.Topology{
						Name: "Topo1",
					},
					InstanceName: lo.ToPtr("noInstance"),
				}

				f.labRepo.On("GetByUuid", mock.Anything, "lab-no-instance").Return(lab, nil)
			},
			expectOK:  false,
			expectErr: true,
		},
		{
			name: "invalid command",
			setup: func(f *fields, a *args) {
				a.cmd = LabCommand(999)
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}
			},
			expectOK:  false,
			expectErr: true,
		},
		{
			name: "stop node fails when node is nil",
			setup: func(f *fields, a *args) {
				a.cmd = stopNodeCommand
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}
			},
			expectOK:  false,
			expectErr: true,
		},
		{
			name: "stop node returns error",
			setup: func(f *fields, a *args) {
				a.cmd = stopNodeCommand
				a.labId = "lab12"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123"}

				f.labRepo.On("GetByUuid", mock.Anything, "lab12").
					Return(&Lab{UUID: "lab12", Creator: user.User{UUID: "user123"}}, nil)
			},
			expectOK:  false,
			expectErr: true,
		},
		{
			name: "start node fails when node is nil",
			setup: func(f *fields, a *args) {
				a.cmd = startNodeCommand
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}
			},
			expectOK:  false,
			expectErr: true,
		},
		{
			name: "start node returns error",
			setup: func(f *fields, a *args) {
				a.cmd = startNodeCommand
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123"}

				f.labRepo.On("GetByUuid", mock.Anything, "lab123").
					Return(&Lab{UUID: "lab123", Creator: user.User{UUID: "user123"}}, nil)
			},
			expectOK:  false,
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fields{
				labRepo:        &mockLabRepo{},
				storageManager: &mockStorageManager{},
				deployment:     &MockDeploymentProvider{},
				socketManager:  realSocketManager,
			}
			a := &args{}
			tt.setup(f, a)
			topologyRepo := &mockTopologyRepo{}
			topologyRepo.On("Update", mock.Anything, mock.Anything).Return(nil)

			svc := &labService{
				labRepo:                f.labRepo,
				storageManager:         f.storageManager,
				topologyRepo:           topologyRepo,
				deploymentProvider:     f.deployment,
				statusMessageNamespace: &fakeNamespace[statusMessage.StatusMessage]{},
				labUpdatesNamespace:    &fakeNamespace[string]{},
				socketManager:          f.socketManager,
				scheduledLabs:          map[string]struct{}{},
				instances: map[string]*Instance{
					"lab123": {
						LogNamespace: &fakeNamespace[string]{},
					},
					"lab12": {
						State: InstanceStates.Running,
						Nodes: []InstanceNode{
							{Name: "someNode"},
						},
						TopologyFile: "/tmp/topology.clab.yaml",
						LogNamespace: &fakeNamespace[string]{},
					},
				},
			}

			var okCalled, errCalled bool
			var receivedErr utils.ErrorResponse
			svc.handleLabCommand(context.Background(), &LabCommandData{
				LabId:   a.labId,
				Command: a.cmd,
				Node:    a.Node,
			}, a.authUser,
				func(_ utils.OkResponse[any]) { okCalled = true },
				func(err utils.ErrorResponse) {
					errCalled = true
					receivedErr = err
				},
			)

			assert.Equal(t, tt.expectOK, okCalled)
			assert.Equal(t, tt.expectErr, errCalled)

			switch tt.name {
			case "deploy success":
				assert.True(t, okCalled)
				f.labRepo.AssertCalled(t, "GetByUuid", mock.Anything, "lab12")
				f.deployment.AssertCalled(t, "Deploy", mock.Anything, "/tmp/topology.clab.yaml", mock.Anything)
			case "deploy command returns error":
				f.labRepo.AssertCalled(t, "GetByUuid", mock.Anything, "lab-error")
			case "destroy command succeeds":
				f.deployment.AssertCalled(t, "Destroy", mock.Anything, mock.AnythingOfType("string"), mock.Anything)
				f.storageManager.AssertCalled(t, "DeleteRunEnvironment", "lab123")
			case "destroy command fails when lab has no instance":
				assert.NotContains(t, svc.instances, "lab-no-instance")
			case "invalid command", "stop node fails when node is nil", "start node fails when node is nil":
				assert.True(t, errCalled)
			case "stop node returns error", "start node returns error":
				assert.Equal(t, -1, receivedErr.Code)
				assert.Equal(t, utils.ErrorNodeNotFound.Error(), receivedErr.Message)
			}
		})
	}
}

func TestDestroyLabCommand(t *testing.T) {
	type fields struct {
		labRepo   *mockLabRepo
		instances map[string]*Instance
	}
	type args struct {
		labId    string
		authUser *auth.AuthenticatedUser
	}
	tests := []struct {
		name      string
		setup     func(f *fields, a *args)
		expectErr error
		assert    func(t *testing.T, f *fields)
	}{
		{
			name: "returns error if GetByUuid fails",
			setup: func(f *fields, a *args) {
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}
				f.labRepo.On("GetByUuid", mock.Anything, "lab123").
					Return(nil, errors.New("db error"))
			},
			expectErr: errors.New("db error"),
			assert: func(t *testing.T, f *fields) {
				f.labRepo.AssertCalled(t, "GetByUuid", mock.Anything, "lab123")
			},
		},
		{
			name: "returns error if user is not owner or admin",
			setup: func(f *fields, a *args) {
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "otherUser", IsAdmin: false}
				lab := &Lab{
					UUID: "lab123",
					Creator: user.User{
						UUID: "ownerId",
					},
				}
				f.labRepo.On("GetByUuid", mock.Anything, "lab123").Return(lab, nil)
			},
			expectErr: utils.ErrorNoDestroyAccessToLab,
			assert: func(t *testing.T, f *fields) {
				f.labRepo.AssertCalled(t, "GetByUuid", mock.Anything, "lab123")
			},
		},
		{
			name: "returns error if instance is missing",
			setup: func(f *fields, a *args) {
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123", IsAdmin: false}
				lab := &Lab{
					UUID: "lab123",
					Creator: user.User{
						UUID: "user123",
					},
				}
				f.labRepo.On("GetByUuid", mock.Anything, "lab123").Return(lab, nil)
				f.instances = make(map[string]*Instance) // simulate missing instance
			},
			expectErr: utils.ErrorLabNotRunning,
			assert: func(t *testing.T, f *fields) {
				f.labRepo.AssertCalled(t, "GetByUuid", mock.Anything, "lab123")
				_, exists := f.instances["lab123"]
				assert.False(t, exists, "expected no instance in memory")
			},
		},
		// Success case already tested in TestHandleLabCommand
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fields{
				labRepo: &mockLabRepo{},
				instances: map[string]*Instance{
					"lab123": {
						LogNamespace: &fakeNamespace[string]{},
					},
				},
			}
			a := &args{}
			tt.setup(f, a)

			svc := &labService{
				labRepo:   f.labRepo,
				instances: f.instances,
			}

			err := svc.destroyLabCommand(context.Background(), a.labId, a.authUser)
			if tt.expectErr != nil {
				assert.EqualError(t, err, tt.expectErr.Error())
			} else {
				assert.NoError(t, err)
			}

			if tt.assert != nil {
				tt.assert(t, f)
			}
		})
	}
}

func TestDeployLabCommand(t *testing.T) {
	type fields struct {
		labRepo *mockLabRepo
	}
	type args struct {
		labId    string
		authUser *auth.AuthenticatedUser
		lab      *Lab
	}
	tests := []struct {
		name      string
		setup     func(f *fields, a *args)
		expectErr error
		validate  func(t *testing.T, svc *labService, a *args)
	}{
		{
			name: "returns error when labRepo.GetByUuid fails",
			setup: func(f *fields, a *args) {
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123"}
				f.labRepo.On("GetByUuid", mock.Anything, "lab123").
					Return(nil, errors.New("fetch failed"))
			},
			expectErr: errors.New("fetch failed"),
			validate: func(t *testing.T, svc *labService, a *args) {
				svc.labRepo.(*mockLabRepo).AssertCalled(t, "GetByUuid", mock.Anything, a.labId)
			},
		},
		{
			name: "returns error when user is not creator or admin",
			setup: func(f *fields, a *args) {
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "unauthorized"}
				f.labRepo.On("GetByUuid", mock.Anything, "lab123").
					Return(&Lab{
						UUID:    "lab123",
						Creator: user.User{UUID: "user123"},
					}, nil)
			},
			expectErr: utils.ErrorNoDeployAccessToLab,
			validate: func(t *testing.T, svc *labService, a *args) {
				svc.labRepo.(*mockLabRepo).AssertCalled(t, "GetByUuid", mock.Anything, a.labId)
			},
		},
		{
			name: "returns error if redeploy is not allowed",
			setup: func(f *fields, a *args) {
				a.labId = "lab123"
				a.authUser = &auth.AuthenticatedUser{UserId: "user123"}
				f.labRepo.On("GetByUuid", mock.Anything, "lab123").
					Return(&Lab{
						UUID:    "lab123",
						Creator: user.User{UUID: "user123"},
					}, nil)
			},
			expectErr: utils.ErrorLabActionInProgress,
			validate: func(t *testing.T, svc *labService, a *args) {
				svc.labRepo.(*mockLabRepo).AssertCalled(t, "GetByUuid", mock.Anything, a.labId)
				assert.True(t, svc.instances["lab123"] != nil, "expected lab123 to exist in instances")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fields{
				labRepo: &mockLabRepo{},
			}
			a := &args{}
			tt.setup(f, a)

			svc := &labService{
				labRepo:   f.labRepo,
				instances: map[string]*Instance{},
			}

			if tt.name == "returns error if redeploy is not allowed" {
				svc.instances["lab123"] = &Instance{}
			}

			err := svc.deployLabCommand(context.Background(), a.labId, a.authUser)

			if tt.expectErr != nil {
				assert.EqualError(t, err, tt.expectErr.Error())
			} else {
				assert.NoError(t, err)
			}

			if tt.validate != nil {
				tt.validate(t, svc, a)
			}
		})

	}
}

func TestStopNodeCommand_NodeNil_ShouldReturnError(t *testing.T) {
	service := &labService{}
	err := service.stopNodeCommand(context.Background(), "some-lab", nil, nil)
	assert.Error(t, err)
	assert.Equal(t, utils.ErrorNodeNotFound, err)
}

// --- Test startNodeCommand when node is nil ---
func TestStartNodeCommand_NodeNil_ShouldReturnError(t *testing.T) {
	service := &labService{}
	err := service.startNodeCommand(context.Background(), "some-lab", nil, nil)
	assert.Error(t, err)
	assert.Equal(t, utils.ErrorNodeNotFound, err)
}

// --- Mock NamespaceManager to record messages ---
type recordNamespaceManager struct {
	msgs []string
}

func (m *recordNamespaceManager) Send(msg string) {
	m.msgs = append(m.msgs, msg)
}
func (m *recordNamespaceManager) SendTo(msg string, receivers []string) {}
func (m *recordNamespaceManager) SendToAdmins(msg string)               {}
func (m *recordNamespaceManager) Broadcast(data string)                 {}
func (m *recordNamespaceManager) Register(_ func(string)) func()        { return func() {} }
func (m *recordNamespaceManager) ClearBacklog()                         {}

func TestStreamClabOutput_SanitizesAndSendsLines(t *testing.T) {
	ns := &recordNamespaceManager{}
	output := "\u001b[0mClean Line\nSecond Line\u001b[0m"

	streamClabOutput(ns, &output)
	assert.Equal(t, []string{"\u001bClean Line", "Second Line\u001b"}, ns.msgs)
}

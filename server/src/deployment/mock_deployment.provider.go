package deployment

import (
	"context"
)

type MockDeploymentProvider struct {
	DeployFunc              func(ctx context.Context, topologyFile string, onLog func(string)) (*string, error)
	DestroyFunc             func(ctx context.Context, topologyFile string, onLog func(string)) (*string, error)
	InspectFunc             func(ctx context.Context, topologyFile string, onLog func(string)) (*InspectOutput, error)
	InspectAllFunc          func(ctx context.Context) (*InspectOutput, error)
	RedeployFunc            func(ctx context.Context, topologyFile string, onLog func(string)) (*string, error)
	StreamContainerLogsFunc func(ctx context.Context, topologyFile string, containerID string, onLog func(string)) error
}

func (m *MockDeploymentProvider) Deploy(ctx context.Context, topologyFile string, onLog func(string)) (*string, error) {
	if m.DeployFunc != nil {
		return m.DeployFunc(ctx, topologyFile, onLog)
	}
	output := "mock deploy output"
	return &output, nil
}

func (m *MockDeploymentProvider) Destroy(ctx context.Context, topologyFile string, onLog func(string)) (*string, error) {
	if m.DestroyFunc != nil {
		return m.DestroyFunc(ctx, topologyFile, onLog)
	}
	output := "mock destroy output"
	return &output, nil
}

func (m *MockDeploymentProvider) Inspect(ctx context.Context, topologyFile string, onLog func(string)) (*InspectOutput, error) {
	if m.InspectFunc != nil {
		return m.InspectFunc(ctx, topologyFile, onLog)
	}
	return &InspectOutput{Containers: []InspectContainer{}}, nil
}

func (m *MockDeploymentProvider) InspectAll(ctx context.Context) (*InspectOutput, error) {
	if m.InspectAllFunc != nil {
		return m.InspectAllFunc(ctx)
	}
	return &InspectOutput{Containers: []InspectContainer{}}, nil
}

func (m *MockDeploymentProvider) Redeploy(ctx context.Context, topologyFile string, onLog func(string)) (*string, error) {
	if m.RedeployFunc != nil {
		return m.RedeployFunc(ctx, topologyFile, onLog)
	}
	output := "mock redeploy output"
	return &output, nil
}

func (m *MockDeploymentProvider) Exec(ctx context.Context, topologyFile string, content string, onLog func(string), onDone func(*string, error)) {
	onDone(nil, nil)
}

func (m *MockDeploymentProvider) ExecOnNode(ctx context.Context, topologyFile string, content string, nodeName string, onLog func(string), onDone func(*string, error)) {
	onDone(nil, nil)
}

func (m *MockDeploymentProvider) Save(ctx context.Context, topologyFile string, onLog func(string), onDone func(*string, error)) {
	onDone(nil, nil)
}

func (m *MockDeploymentProvider) SaveOnNode(ctx context.Context, topologyFile string, nodeName string, onLog func(string), onDone func(*string, error)) {
	onDone(nil, nil)
}

func (m *MockDeploymentProvider) StreamContainerLogs(ctx context.Context, topologyFile string, containerID string, onLog func(string)) error {
	if m.StreamContainerLogsFunc != nil {
		return m.StreamContainerLogsFunc(ctx, topologyFile, containerID, onLog)
	}
	return nil
}

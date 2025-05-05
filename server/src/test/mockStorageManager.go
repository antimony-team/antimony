package test

import (
	"errors"
	"path/filepath"
	"sync"
)

type mockStorageManager struct {
	topologies map[string]string
	metadata   map[string]string
	binds      map[string]map[string]string
	mu         sync.RWMutex
}

func CreateMockStorageManager() *mockStorageManager {
	return &mockStorageManager{
		topologies: make(map[string]string),
		metadata:   make(map[string]string),
		binds:      make(map[string]map[string]string),
	}
}

func (m *mockStorageManager) WriteTopology(topologyId string, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.topologies[topologyId] = content
	return nil
}

func (m *mockStorageManager) WriteMetadata(topologyId string, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.metadata[topologyId] = content
	return nil
}

func (m *mockStorageManager) WriteBindFile(topologyId, filePath, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.binds[topologyId] == nil {
		m.binds[topologyId] = make(map[string]string)
	}
	m.binds[topologyId][filePath] = content
	return nil
}

func (m *mockStorageManager) ReadTopology(topologyId string, content *string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if val, ok := m.topologies[topologyId]; ok {
		*content = val
		return nil
	}
	return errors.New("topology not found")
}

func (m *mockStorageManager) ReadMetadata(topologyId string, content *string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if val, ok := m.metadata[topologyId]; ok {
		*content = val
		return nil
	}
	return errors.New("metadata not found")
}

func (m *mockStorageManager) ReadBindFile(topologyId, filePath string, content *string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if tMap, ok := m.binds[topologyId]; ok {
		if val, ok := tMap[filePath]; ok {
			*content = val
			return nil
		}
	}
	return errors.New("bind file not found")
}

func (m *mockStorageManager) DeleteBindFile(topologyId, filePath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if tMap, ok := m.binds[topologyId]; ok {
		delete(tMap, filePath)
		return nil
	}
	return errors.New("topology not found")
}

func (m *mockStorageManager) GetRunTopologyFile(labId string) string {
	// Just simulate a path
	return filepath.Join("/tmp/mocklabs", labId, "topology.yml")
}

func (m *mockStorageManager) CreateRunEnvironment(topologyId string, labId string, topologyDefinition string, topologyFilePath *string) error {
	if topologyFilePath != nil {
		*topologyFilePath = m.GetRunTopologyFile(labId)
	}
	return nil
}

func (m *mockStorageManager) DeleteRunEnvironment(labId string) error {
	// Simulate success
	return nil
}

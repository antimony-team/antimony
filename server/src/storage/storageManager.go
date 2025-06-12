package storage

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/charmbracelet/log"
	cp "github.com/otiai10/copy"
)

type (
	StorageManager interface {
		ReadTopology(topologyId string, content *string) error
		WriteTopology(topologyId string, content string) error
		ReadBindFile(topologyId string, filePath string, content *string) error
		WriteBindFile(topologyId string, filePath string, content string) error
		DeleteBindFile(topologyId string, filePath string) error

		GetRunTopologyFile(labId string) string

		CreateRunEnvironment(topologyId string, labId string, topologyDefinition string, topologyFilePath *string) error
		DeleteRunEnvironment(labId string) error
	}

	storageManager struct {
		storagePath    string
		runPath        string
		fileCache      map[string]string
		fileCacheMutex *sync.Mutex
		copyOptions    cp.Options
	}
)

func CreateStorageManager(config *config.AntimonyConfig) StorageManager {
	storageManager := &storageManager{
		storagePath:    config.FileSystem.Storage,
		runPath:        config.FileSystem.Run,
		fileCache:      make(map[string]string),
		fileCacheMutex: &sync.Mutex{},
		copyOptions: cp.Options{
			Sync: true,
		},
	}

	storageManager.setupDirectories()

	return storageManager
}

func (s *storageManager) CreateRunEnvironment(
	topologyId string,
	labId string,
	topologyDefinition string,
	topologyFilePath *string,
) error {
	absoluteStoragePath := filepath.Join(s.storagePath, topologyId)
	absoluteRunPath := filepath.Join(s.runPath, labId)

	if err := cp.Copy(absoluteStoragePath, absoluteRunPath, s.copyOptions); err != nil {
		log.Errorf("Failed to create run directory for lab: %s", err.Error())
		return err
	}

	runDefinitionPath := getRunDefinitionFilePath(labId)
	if err := s.writeRun(runDefinitionPath, topologyDefinition); err != nil {
		log.Errorf("Failed to write run definition for lab: %s", err.Error())
		return err
	}

	*topologyFilePath = filepath.Join(s.runPath, runDefinitionPath)
	return nil
}

func (s *storageManager) GetRunTopologyFile(labId string) string {
	runDefinitionPath := getRunDefinitionFilePath(labId)
	return filepath.Join(s.runPath, runDefinitionPath)
}

func (s *storageManager) ReadRunTopologyDefinition(labId string, content *string) error {
	return s.readRun(getRunDefinitionFilePath(labId), content)
}

func (s *storageManager) ReadTopology(topologyId string, content *string) error {
	return s.readStorage(getDefinitionFilePath(topologyId), content)
}

func (s *storageManager) WriteTopology(topologyId string, content string) error {
	return s.writeStorage(getDefinitionFilePath(topologyId), content)
}

func (s *storageManager) ReadBindFile(topologyId string, filePath string, content *string) error {
	return s.readStorage(getBindFilePath(topologyId, filePath), content)
}

func (s *storageManager) WriteBindFile(topologyId string, filePath string, content string) error {
	return s.writeStorage(getBindFilePath(topologyId, filePath), content)
}

func (s *storageManager) DeleteBindFile(topologyId string, filePath string) error {
	return s.deleteStorage(getBindFilePath(topologyId, filePath))
}

func (s *storageManager) DeleteRunEnvironment(labId string) error {
	return s.deleteRun(labId)
}

func (s *storageManager) setupDirectories() {
	if _, err := os.ReadDir(s.storagePath); err != nil || !utils.IsDirectoryWritable(s.storagePath) {
		log.Info("Storage directory not found. Creating.", "dir", s.storagePath)
		if err = os.MkdirAll(s.storagePath, 0750); err != nil {
			log.Fatal("Storage directory is not accessible. Exiting.", "dir", s.storagePath)
			return
		}
	}

	if _, err := os.ReadDir(s.runPath); err != nil || !utils.IsDirectoryWritable(s.runPath) {
		log.Info("Run directory not found. Creating.", "dir", s.runPath)
		if err = os.MkdirAll(s.runPath, 0750); err != nil {
			log.Fatal("Run directory is not accessible. Exiting.", "dir", s.runPath)
			return
		}
	}
}

func (s *storageManager) writeStorage(relativeFilePath string, content string) error {
	return s.write(filepath.Join(s.storagePath, relativeFilePath), content)
}

func (s *storageManager) writeRun(relativeFilePath string, content string) error {
	return s.write(filepath.Join(s.runPath, relativeFilePath), content)
}

func (s *storageManager) readStorage(relativeFilePath string, content *string) error {
	return s.read(filepath.Join(s.storagePath, relativeFilePath), content)
}

func (s *storageManager) readRun(relativeFilePath string, content *string) error {
	return s.read(filepath.Join(s.runPath, relativeFilePath), content)
}

func (s *storageManager) deleteStorage(relativePath string) error {
	return s.delete(filepath.Join(s.storagePath, relativePath))
}

func (s *storageManager) deleteRun(relativePath string) error {
	return s.delete(filepath.Join(s.runPath, relativePath))
}

func (s *storageManager) read(absoluteFilePath string, content *string) error {
	if data, err := os.ReadFile(absoluteFilePath); err != nil {
		return err
	} else {
		*content = string(data)
	}

	return nil
}

func (s *storageManager) write(absoluteFilePath string, content string) error {
	if _, err := os.ReadDir(filepath.Dir(absoluteFilePath)); err != nil {
		if err = os.MkdirAll(filepath.Dir(absoluteFilePath), 0750); err != nil {
			return utils.ErrFileStorage
		}
	}

	//nolint:gosec // We need this file to be accessible
	return os.WriteFile(absoluteFilePath, ([]byte)(content), 0750)
}

func (s *storageManager) delete(absolutePath string) error {
	if err := os.RemoveAll(absolutePath); err != nil {
		return err
	}

	return nil
}

func getDefinitionFilePath(topologyId string) string {
	return filepath.Join(topologyId, "topology.clab.yaml")
}

func getRunDefinitionFilePath(labId string) string {
	return filepath.Join(labId, "topology.clab.yaml")
}

func getBindFilePath(topologyId string, filePath string) string {
	return fmt.Sprintf("%s/%s", topologyId, filePath)
}

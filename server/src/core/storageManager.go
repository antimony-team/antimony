package core

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"fmt"
	"github.com/charmbracelet/log"
	"os"
	"path/filepath"
	"sync"
)

type (
	StorageManager interface {
		ReadTopology(topologyId string, content *string) error
		WriteTopology(topologyId string, content string) error
		ReadMetadata(topologyId string, content *string) error
		WriteMetadata(topologyId string, content string) error
		ReadBindFile(topologyId string, filePath string, content *string) error
		WriteBindFile(topologyId string, filePath string, content string) error
		DeleteBindFile(topologyId string, filePath string) error
	}

	storageManager struct {
		storagePath    string
		fileCache      map[string]string
		fileCacheMutex *sync.Mutex
	}
)

func CreateStorageManager(config *config.AntimonyConfig) StorageManager {
	storageManager := &storageManager{
		storagePath:    config.Storage.Directory,
		fileCache:      make(map[string]string),
		fileCacheMutex: &sync.Mutex{},
	}

	//storageManager.preloadFiles(config)

	return storageManager
}

func (s *storageManager) ReadTopology(topologyId string, content *string) error {
	return s.read(getDefinitionFilePath(topologyId), content)
}

func (s *storageManager) WriteTopology(topologyId string, content string) error {
	return s.write(getDefinitionFilePath(topologyId), content)
}

func (s *storageManager) ReadMetadata(topologyId string, content *string) error {
	return s.read(getMetadataFilePath(topologyId), content)
}

func (s *storageManager) WriteMetadata(topologyId string, content string) error {
	return s.write(getMetadataFilePath(topologyId), content)
}

func (s *storageManager) ReadBindFile(topologyId string, filePath string, content *string) error {
	return s.read(getBindFilePath(topologyId, filePath), content)
}

func (s *storageManager) WriteBindFile(topologyId string, filePath string, content string) error {
	return s.write(getBindFilePath(topologyId, filePath), content)
}

func (s *storageManager) DeleteBindFile(topologyId string, filePath string) error {
	return s.delete(getBindFilePath(topologyId, filePath))
}

func (s *storageManager) preloadFiles(config *config.AntimonyConfig) {
	files, err := os.ReadDir(config.Storage.Directory)

	if err != nil {
		log.Info("Storage directory not found. Creating.")
		if err = os.MkdirAll(config.Storage.Directory, 0755); err != nil || !utils.IsDirectoryWritable(config.Storage.Directory) {
			log.Fatal("Storage directory is not writable. Exiting.")
		}
	}

	if len(files) == 0 {
		log.Info("No files to preload. Skipping.")
		return
	} else {
		log.Info("Preloading files from storage.", "files", len(files))
	}

	preloadCount := 0
	for _, e := range files {
		var content string
		if err := s.read(e.Name(), &content); err != nil {
			filePath := filepath.Join(s.storagePath, e.Name())
			log.Warnf("Failed to preload storage file '%s': %s", filePath, err.Error())
			continue
		}
		preloadCount++
	}

	log.Info("Successfully preloaded files from storage.", "files", fmt.Sprintf("%d/%d", preloadCount, len(files)))
}

func (s *storageManager) read(filePath string, content *string) error {
	absolutePath := filepath.Join(s.storagePath, filePath)
	if data, err := os.ReadFile(absolutePath); err != nil {
		return err
	} else {
		*content = string(data)
		s.fileCacheMutex.Lock()
		s.fileCache[filePath] = string(data)
		s.fileCacheMutex.Unlock()
	}

	return nil
}

func (s *storageManager) write(filePath string, content string) error {
	absolutePath := filepath.Join(s.storagePath, filePath)

	if _, err := os.ReadDir(filepath.Dir(absolutePath)); err != nil {
		if err = os.MkdirAll(filepath.Dir(absolutePath), 0755); err != nil {
			return utils.ErrorFileStorage
		}
	}

	return os.WriteFile(absolutePath, ([]byte)(content), 0755)
}

func (s *storageManager) delete(filePath string) error {
	absolutePath := filepath.Join(s.storagePath, filePath)
	if err := os.RemoveAll(absolutePath); err != nil {
		return err
	}

	return nil
}

func getDefinitionFilePath(topologyId string) string {
	return fmt.Sprintf("%s/topology.clab.yaml", topologyId)
}

func getMetadataFilePath(topologyId string) string {
	return fmt.Sprintf("%s/topology.meta", topologyId)
}

func getBindFilePath(topologyId string, filePath string) string {
	return fmt.Sprintf("%s/%s", topologyId, filePath)
}

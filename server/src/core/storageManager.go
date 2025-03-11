package core

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"fmt"
	"github.com/charmbracelet/log"
	"os"
	"path/filepath"
)

type (
	StorageManager interface {
		PreloadFiles(config *config.AntimonyConfig)
		Read(fileName string, content *string) error
		Write(fileName string, content string) error
	}

	storageManager struct {
		storagePath string
		fileCache   map[string]string
	}
)

func CreateStorageManager(config *config.AntimonyConfig) StorageManager {
	storageManager := &storageManager{
		storagePath: config.Storage.Directory,
		fileCache:   make(map[string]string),
	}

	storageManager.PreloadFiles(config)

	return storageManager
}

func (s *storageManager) PreloadFiles(config *config.AntimonyConfig) {
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
		if err := s.Read(e.Name(), &content); err != nil {
			filePath := filepath.Join(s.storagePath, e.Name())
			log.Warnf("Failed to preload storage file '%s': %s", filePath, err.Error())
			continue
		}
		preloadCount++
	}

	log.Info("Successfully preloaded files from storage.", "files", fmt.Sprintf("%d/%d", preloadCount, len(files)))
}

func (s *storageManager) Read(fileName string, content *string) error {
	filePath := filepath.Join(s.storagePath, fileName)
	if data, err := os.ReadFile(filePath); err != nil {
		return err
	} else {
		*content = string(data)
		s.fileCache[fileName] = string(data)
	}

	return nil
}

func (s *storageManager) Write(fileName string, content string) error {
	filePath := filepath.Join(s.storagePath, fileName)
	return os.WriteFile(filePath, ([]byte)(content), 0755)
}

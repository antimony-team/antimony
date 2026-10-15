package device

import (
	"antimonyBackend/config"
	"encoding/json"
	"io"
	"os"

	"github.com/charmbracelet/log"
)

type (
	Service struct {
		devices []DeviceConfig
	}
)

func CreateService(config *config.AntimonyConfig) *Service {
	deviceConfig := make([]DeviceConfig, 0)

	deviceConfigFile, err := os.Open(config.Containerlab.DeviceConfig)

	if err != nil {
		log.Error("Failed to open device config file", "file", config.Containerlab.DeviceConfig)
	} else if fileData, err := io.ReadAll(deviceConfigFile); err != nil {
		log.Error(
			"Failed to read device config file",
			"file",
			config.Containerlab.DeviceConfig,
			"err",
			err.Error(),
		)
	} else if err := json.Unmarshal(fileData, &deviceConfig); err != nil {
		log.Error(
			"Failed to parse device config file",
			"file",
			config.Containerlab.DeviceConfig,
			"err",
			err.Error(),
		)
	}

	if deviceConfigFile != nil {
		_ = deviceConfigFile.Close()
	}

	return &Service{
		devices: deviceConfig,
	}
}

func (s *Service) Get() []DeviceConfig {
	return s.devices
}

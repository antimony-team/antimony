package device

import (
	"antimonyBackend/config"
	"encoding/json"
	"github.com/charmbracelet/log"
	"io"
	"os"
)

type (
	Service interface {
		Get() []DeviceConfig
	}

	deviceService struct {
		devices []DeviceConfig
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	deviceConfig := make([]DeviceConfig, 0)

	if deviceConfigFile, err := os.Open(config.Containerlab.DeviceConfig); err != nil {
		log.Error("Failed to open device config file", "file", config.Containerlab.DeviceConfig)
	} else if fileData, err := io.ReadAll(deviceConfigFile); err != nil {
		log.Error("Failed to read device config file", "file", config.Containerlab.DeviceConfig, "err", err.Error())
	} else if err := json.Unmarshal(fileData, &deviceConfig); err != nil {
		log.Error("Failed to parse device config file", "file", config.Containerlab.DeviceConfig, "err", err.Error())
	}

	return &deviceService{
		devices: deviceConfig,
	}
}

func (s *deviceService) Get() []DeviceConfig {
	return s.devices
}

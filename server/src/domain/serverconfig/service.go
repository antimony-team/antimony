package serverconfig

import (
	"antimonyBackend/config"
)

type Service struct {
	config *config.AntimonyConfig
}

func CreateService(config *config.AntimonyConfig) *Service {
	return &Service{
		config: config,
	}
}

func (s *Service) GetServerConfig() ServerConfig {
	return ServerConfig{
		CaptureConfig: CaptureConfig{
			Enabled:            s.config.Capture.Enabled,
			Port:               s.config.Capture.SSHPort,
			ExcludedInterfaces: s.config.Capture.ExcludedInterfaces,
		},
	}
}

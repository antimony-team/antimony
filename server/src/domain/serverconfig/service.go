package serverconfig

import (
	"antimonyBackend/config"
)

type (
	Service interface {
		GetServerConfig() ServerConfig
	}

	service struct {
		config *config.AntimonyConfig
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	return &service{
		config: config,
	}
}

func (s *service) GetServerConfig() ServerConfig {
	return ServerConfig{
		CaptureConfig: CaptureConfig{
			Enabled:            s.config.Capture.Enabled,
			Port:               s.config.Capture.SSHPort,
			ExcludedInterfaces: s.config.Capture.ExcludedInterfaces,
		},
	}
}

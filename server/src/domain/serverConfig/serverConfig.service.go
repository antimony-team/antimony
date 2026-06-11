package serverConfig

import (
	"antimonyBackend/config"
)

type (
	Service interface {
		GetServerConfig() ServerConfig
	}

	configService struct {
		config *config.AntimonyConfig
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	return &configService{
		config: config,
	}
}

func (s *configService) GetServerConfig() ServerConfig {
	return ServerConfig{
		CaptureConfig: CaptureConfig{
			Enabled:            s.config.Capture.Enabled,
			Port:               s.config.Capture.SSHPort,
			ExcludedInterfaces: s.config.Capture.ExcludedInterfaces,
		},
	}
}

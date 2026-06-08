package serverConfig

import (
	"antimonyBackend/config"
)

type (
	Service interface {
		GetServerConfig() ServerConfigOut
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

func (s *configService) GetServerConfig() ServerConfigOut {
	return ServerConfigOut{
		CaptureConfig: captureConfigOut{
			Enabled:            s.config.Capture.Enabled,
			Port:               s.config.Capture.SSHPort,
			ExcludedInterfaces: s.config.Capture.ExcludedInterfaces,
		},
	}
}

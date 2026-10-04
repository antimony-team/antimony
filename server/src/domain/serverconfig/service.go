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
		SSHConfig: SSHConfig{
			Enabled: s.config.SSH.Enabled,
			Port:    s.config.SSH.SSHPort,
		},
		CaptureConfig: CaptureConfig{
			Enabled:            s.config.Capture.Enabled,
			ExcludedInterfaces: s.config.Capture.ExcludedInterfaces,
		},
		DeploymentConfig: DeploymentConfig{
			Provider: s.config.Deployment.Provider.String(),
		},
	}
}

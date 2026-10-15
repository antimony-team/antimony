package serverconfig

import (
	"github.com/antimony-team/antimony-server/config"
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
			Provider: string(s.config.Deployment.Provider),
		},
	}
}

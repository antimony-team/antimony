package deployment

import (
	"antimonyBackend/config"
	"github.com/charmbracelet/log"
)

func GetProvider(config *config.AntimonyConfig) DeploymentProvider {
	if config.General.Provider == "clabernetes" {
		log.Info("Using the Clabernetes deployment provider.")
		return &ClabernetesProvider{}
	}

	log.Info("Using the Containerlab deployment provider.")
	return &ContainerlabProvider{}
}

package deployment

import (
	"antimonyBackend/config"

	"github.com/charmbracelet/log"
)

func CreateProvider(antimonyConfig *config.AntimonyConfig) DeploymentProvider {
	if antimonyConfig.Deployment.Provider == config.Containerlab {
		log.Info("Using the Clabernetes deployment provider.")
		return CreateClabernetesProvider()
	}

	log.Info("Using the Containerlab deployment provider.")
	return CreateContainerlabProvider()
}

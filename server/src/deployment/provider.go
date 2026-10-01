package deployment

import (
	"antimonyBackend/config"

	"github.com/charmbracelet/log"
)

func CreateProvider(antimonyConfig *config.AntimonyConfig) DeploymentProvider {
	if antimonyConfig.Deployment.Provider == config.Clabernetes {
		log.Info("Using the Clabernetes deployment provider.")
		return CreateClabernetesProvider()
	}

	if antimonyConfig.Deployment.Provider == config.Dummy {
		log.Warn("Using the dummy deployment provider. Labs will not actually be deployed.")
		return CreateDummyProvider()
	}

	log.Info("Using the Containerlab deployment provider.")
	return CreateContainerlabProvider()
}

package deployment

import (
	"antimonyBackend/config"
	"time"

	"github.com/charmbracelet/log"
)

func CreateProvider(antimonyConfig *config.AntimonyConfig) DeploymentProvider {
	if antimonyConfig.Deployment.Provider == config.Clabernetes {
		log.Info("Using the Clabernetes deployment provider.")
		return CreateClabernetesProvider()
	}

	if antimonyConfig.Deployment.Provider == config.Dummy {
		log.Warn("Using the dummy deployment provider. Labs will not actually be deployed.")
		provider := CreateDummyProvider()

		// Behave like a real provider where the interface can observe it.
		provider.DeployDelay = time.Second
		provider.EchoShells = true
		provider.EmitContainerLogs = true

		return provider
	}

	log.Info("Using the Containerlab deployment provider.")
	return CreateContainerlabProvider()
}

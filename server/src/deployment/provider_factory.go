package deployment

import (
	"os"
)

// GetProvider returns the correct DeploymentProvider implementation based on the DEPLOYMENT_PROVIDER env variable.
func GetProvider() DeploymentProvider {
	switch os.Getenv("DEPLOYMENT_PROVIDER") {
	case "clabernetes":
		return &ClabernetesProvider{}
	default:
		return &ContainerlabProvider{}
	}
}

package deployment

import (
	"antimonyBackend/config"
	"testing"

	"github.com/stretchr/testify/assert"
)

// Only the dummy branch is exercised here, the other providers need a Docker or Kubernetes
// environment and call log.Fatal when it is missing.
func TestCreateProvider_SelectsTheDummyProvider(t *testing.T) {
	provider := CreateProvider(&config.AntimonyConfig{
		Deployment: config.DeploymentConfig{Provider: config.Dummy},
	})

	assert.IsType(t, &DummyProvider{}, provider)
}

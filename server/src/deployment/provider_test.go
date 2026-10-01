package deployment

import (
	"antimonyBackend/config"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Only the dummy branch is exercised here, the other providers need a Docker or Kubernetes
// environment and call log.Fatal when it is missing.
func TestCreateProvider_SelectsTheDummyProvider(t *testing.T) {
	provider := CreateProvider(&config.AntimonyConfig{
		Deployment: config.DeploymentConfig{Provider: config.Dummy},
	})

	require.IsType(t, &DummyProvider{}, provider)

	// The server uses the realistic behaviour, the Go test suite the instant and silent defaults.
	dummy := provider.(*DummyProvider)
	assert.Positive(t, dummy.DeployDelay)
	assert.True(t, dummy.EchoShells)
	assert.True(t, dummy.EmitContainerLogs)

	assert.Zero(t, CreateDummyProvider().DeployDelay)
	assert.False(t, CreateDummyProvider().EchoShells)
	assert.False(t, CreateDummyProvider().EmitContainerLogs)
}

package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeConfig(t *testing.T, contents string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "config.yml")
	require.NoError(t, os.WriteFile(path, []byte(contents), 0o600))

	return path
}

/*
 * Load
 */

func TestLoad_MissingFileFallsBackToDefaults(t *testing.T) {
	loaded, err := Load(filepath.Join(t.TempDir(), "does-not-exist.yml"))

	require.NoError(t, err, "a missing config file is not an error, it just means defaults")
	require.NotNil(t, loaded)

	assert.Equal(t, "127.0.0.1", loaded.Server.Host)
	assert.Equal(t, uint(3000), loaded.Server.Port)
	assert.Equal(t, Containerlab, loaded.Deployment.Provider)
	assert.True(t, loaded.Auth.EnableNative)
	assert.False(t, loaded.Auth.EnableOpenID)
	assert.Equal(t, "./kinds.conf.yml", loaded.Containerlab.KindsConfig)
}

func TestLoad_OverridesTheValuesThatArePresent(t *testing.T) {
	path := writeConfig(t, `
server:
  host: 0.0.0.0
  port: 8080
deployment:
  provider: clabernetes
shell:
  userLimit: 3
  timeout: 60
`)

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, "0.0.0.0", loaded.Server.Host)
	assert.Equal(t, uint(8080), loaded.Server.Port)
	assert.Equal(t, Clabernetes, loaded.Deployment.Provider)
	assert.Equal(t, 3, loaded.Shell.UserLimit)
	assert.Equal(t, int64(60), loaded.Shell.Timeout)
}

func TestLoad_KeepsDefaultsForAbsentKeys(t *testing.T) {
	// Load starts from defaultConfig and unmarshals over it, so a config that only sets the server
	// block must leave everything else at its default. This is what keeps existing deployments
	// working when a new key is introduced.
	path := writeConfig(t, "server:\n  port: 9999\n")

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, uint(9999), loaded.Server.Port)
	assert.Equal(t, "127.0.0.1", loaded.Server.Host, "an unset sibling key keeps its default")
	assert.Equal(t, "./kinds.conf.yml", loaded.Containerlab.KindsConfig)
	assert.Equal(t, "./data/clab.schema.json", loaded.Containerlab.SchemaFallback)
	assert.Equal(t, 1000, loaded.Streaming.ClabLogBacklog)
	assert.Equal(t, 20, loaded.Shell.UserLimit)
	assert.Equal(t, "./storage/", loaded.FileSystem.Storage)
	assert.Equal(t, "./run/", loaded.FileSystem.Run)
}

func TestLoad_ReadsTheKindsConfigPath(t *testing.T) {
	path := writeConfig(t, "containerlab:\n  kindsConfig: /etc/antimony/kinds.yml\n")

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, "/etc/antimony/kinds.yml", loaded.Containerlab.KindsConfig)
}

func TestLoad_InvalidYamlIsAnError(t *testing.T) {
	path := writeConfig(t, "server:\n\tport: not-valid\n  host: [unclosed\n")

	loaded, err := Load(path)

	require.Error(t, err)
	assert.Nil(t, loaded)
	assert.Contains(t, err.Error(), "parsing config")
}

func TestLoad_WrongTypeIsAnError(t *testing.T) {
	path := writeConfig(t, "server:\n  port: not-a-number\n")

	_, err := Load(path)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "parsing config")
}

func TestLoad_UnknownDeploymentProviderIsAnError(t *testing.T) {
	path := writeConfig(t, "deployment:\n  provider: kubernetes\n")

	_, err := Load(path)

	require.Error(t, err, "an unrecognised provider name must not silently become containerlab")
	assert.Contains(t, err.Error(), "unknown deployment provider")
}

func TestLoad_EmptyFileYieldsDefaults(t *testing.T) {
	path := writeConfig(t, "")

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, "127.0.0.1", loaded.Server.Host)
	assert.Equal(t, Containerlab, loaded.Deployment.Provider)
}

func TestLoad_ParsesTheExcludedInterfaceList(t *testing.T) {
	path := writeConfig(t, `
capture:
  excludedInterfaces: [ "lo", "mgmt0*" ]
`)

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, []string{"lo", "mgmt0*"}, loaded.Capture.ExcludedInterfaces)
}

/*
 * DeploymentProvider
 */

func TestParseDeploymentProvider_KnownNames(t *testing.T) {
	cases := map[string]DeploymentProvider{
		"containerlab":     Containerlab,
		"clabernetes":      Clabernetes,
		"CONTAINERLAB":     Containerlab,
		"ClaberNetes":      Clabernetes,
		"  clabernetes  ":  Clabernetes,
		"\tcontainerlab\n": Containerlab,
	}

	for input, expected := range cases {
		t.Run(input, func(t *testing.T) {
			parsed, err := ParseDeploymentProvider(input)

			require.NoError(t, err)
			assert.Equal(t, expected, parsed)
		})
	}
}

func TestParseDeploymentProvider_UnknownNameIsAnError(t *testing.T) {
	for _, input := range []string{"", "docker", "kubernetes", "clab"} {
		t.Run(input, func(t *testing.T) {
			_, err := ParseDeploymentProvider(input)

			require.Error(t, err)
			assert.Contains(t, err.Error(), "unknown deployment provider")
		})
	}
}

func TestDeploymentProvider_String(t *testing.T) {
	assert.Equal(t, "containerlab", Containerlab.String())
	assert.Equal(t, "clabernetes", Clabernetes.String())
}

func TestDeploymentProvider_StringDescribesAnUnknownValue(t *testing.T) {
	assert.Equal(t, "DeploymentProvider(42)", DeploymentProvider(42).String())
}

func TestDeploymentProvider_MarshalText(t *testing.T) {
	for provider, expected := range map[DeploymentProvider]string{
		Containerlab: "containerlab",
		Clabernetes:  "clabernetes",
	} {
		encoded, err := provider.MarshalText()

		require.NoError(t, err)
		assert.Equal(t, expected, string(encoded))
	}
}

func TestDeploymentProvider_MarshalTextRejectsAnUnknownValue(t *testing.T) {
	_, err := DeploymentProvider(42).MarshalText()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid deployment provider")
}

func TestDeploymentProvider_UnmarshalText(t *testing.T) {
	var provider DeploymentProvider

	require.NoError(t, provider.UnmarshalText([]byte("clabernetes")))
	assert.Equal(t, Clabernetes, provider)

	require.NoError(t, provider.UnmarshalText([]byte("containerlab")))
	assert.Equal(t, Containerlab, provider)
}

func TestDeploymentProvider_UnmarshalTextRejectsAnUnknownName(t *testing.T) {
	var provider DeploymentProvider

	require.Error(t, provider.UnmarshalText([]byte("nope")))
}

func TestDeploymentProvider_TextRoundTrip(t *testing.T) {
	for _, original := range []DeploymentProvider{Containerlab, Clabernetes} {
		encoded, err := original.MarshalText()
		require.NoError(t, err)

		var decoded DeploymentProvider
		require.NoError(t, decoded.UnmarshalText(encoded))

		assert.Equal(t, original, decoded)
	}
}

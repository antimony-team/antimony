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
	assert.Equal(t, DeploymentProviders.Containerlab, loaded.Deployment.Provider)
	assert.Equal(t, []AuthMethod{AuthMethods.Admin}, loaded.Auth.Methods)
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
	assert.Equal(t, DeploymentProviders.Clabernetes, loaded.Deployment.Provider)
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
	assert.Empty(t, loaded.Containerlab.AnnotationsSchemaUrl)
	assert.Equal(t, "./data/clab.annotations.schema.json", loaded.Containerlab.AnnotationsSchemaFallback)
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
	assert.Equal(t, DeploymentProviders.Containerlab, loaded.Deployment.Provider)
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

func TestLoad_ParsesTheSSHServerSettings(t *testing.T) {
	path := writeConfig(t, `
ssh:
  enabled: true
  sshHost: 0.0.0.0
  sshPort: 2222
  sshKeyPath: ./host_key
capture:
  enabled: false
`)

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, SSHConfig{Enabled: true, SSHHost: "0.0.0.0", SSHPort: 2222, SSHKeyPath: "./host_key"}, loaded.SSH)
	assert.False(t, loaded.Capture.Enabled, "capture is switched separately from the SSH server")
}

/*
 * Enums
 */

func TestDeploymentProvider_UnmarshalText(t *testing.T) {
	for _, provider := range []DeploymentProvider{
		DeploymentProviders.Containerlab,
		DeploymentProviders.Clabernetes,
		DeploymentProviders.Dummy,
	} {
		var parsed DeploymentProvider

		require.NoError(t, parsed.UnmarshalText([]byte(provider)))
		assert.Equal(t, provider, parsed)
	}
}

func TestDeploymentProvider_UnmarshalTextRejectsAnUnknownName(t *testing.T) {
	for _, input := range []string{"", "docker", "kubernetes", "clab", "Containerlab"} {
		t.Run(input, func(t *testing.T) {
			var parsed DeploymentProvider

			err := parsed.UnmarshalText([]byte(input))

			require.Error(t, err)
			assert.Contains(t, err.Error(), "unknown deployment provider")
		})
	}
}

func TestAuthMethod_UnmarshalText(t *testing.T) {
	for _, method := range []AuthMethod{AuthMethods.Admin, AuthMethods.OpenID, AuthMethods.Desktop} {
		var parsed AuthMethod

		require.NoError(t, parsed.UnmarshalText([]byte(method)))
		assert.Equal(t, method, parsed)
	}
}

func TestLoad_ParsesTheAuthMethodList(t *testing.T) {
	path := writeConfig(t, "auth:\n  methods: [admin, openid]\n")

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, []AuthMethod{AuthMethods.Admin, AuthMethods.OpenID}, loaded.Auth.Methods)
}

func TestLoad_UnknownAuthMethodIsAnError(t *testing.T) {
	path := writeConfig(t, "auth:\n  methods: [admin, native]\n")

	_, err := Load(path)

	require.Error(t, err)
	assert.Contains(t, err.Error(), `unknown auth method "native"`)
}

func TestLoad_DefaultsToAdminAuthOnly(t *testing.T) {
	loaded, err := Load(writeConfig(t, "auth:\n  openIdIssuer: https://issuer.example\n"))
	require.NoError(t, err)

	assert.Equal(t, []AuthMethod{AuthMethods.Admin}, loaded.Auth.Methods)
	assert.Equal(t, "https://issuer.example", loaded.Auth.OpenIdIssuer)
}

func TestLoad_ParsesEveryAuthMethod(t *testing.T) {
	path := writeConfig(t, "auth:\n  methods:\n    - desktop\n    - openid\n    - admin\n")

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, []AuthMethod{AuthMethods.Desktop, AuthMethods.OpenID, AuthMethods.Admin}, loaded.Auth.Methods)
}

func TestLoad_EmptyAuthMethodListDisablesEveryMethod(t *testing.T) {
	loaded, err := Load(writeConfig(t, "auth:\n  methods: []\n"))
	require.NoError(t, err)

	assert.Empty(t, loaded.Auth.Methods)
}

func TestAuthMethod_UnmarshalTextRejectsAnUnknownName(t *testing.T) {
	for _, input := range []string{"", "native", "oidc", "Admin", "DESKTOP"} {
		t.Run(input, func(t *testing.T) {
			var parsed AuthMethod

			err := parsed.UnmarshalText([]byte(input))

			require.Error(t, err)
			assert.Contains(t, err.Error(), "unknown auth method")
		})
	}
}

func TestLoad_ReadsTheFilesystemPaths(t *testing.T) {
	path := writeConfig(t, "filesystem:\n  storage: /var/lib/antimony/storage\n  run: /run/antimony\n")

	loaded, err := Load(path)
	require.NoError(t, err)

	assert.Equal(t, FilesystemConfig{Storage: "/var/lib/antimony/storage", Run: "/run/antimony"}, loaded.FileSystem)
}

func TestLoad_IgnoresTheOldFileSystemKey(t *testing.T) {
	// The key was renamed from fileSystem to filesystem, the old spelling no longer has any effect.
	loaded, err := Load(writeConfig(t, "fileSystem:\n  storage: /old/storage\n"))
	require.NoError(t, err)

	assert.Equal(t, "./storage/", loaded.FileSystem.Storage)
}

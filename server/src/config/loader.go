package config

import (
	"errors"
	"fmt"
	"os"

	"github.com/charmbracelet/log"
	"gopkg.in/yaml.v2"
)

func Load(fileName string) (*AntimonyConfig, error) {
	config := defaultConfig()

	data, err := os.ReadFile(fileName)
	if errors.Is(err, os.ErrNotExist) {
		log.Warn("Configuration file not found, falling back to defaults.", "path", fileName)
		return config, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading config %s: %w", fileName, err)
	}
	if err := yaml.Unmarshal(data, config); err != nil {
		return nil, fmt.Errorf("parsing config %s: %w", fileName, err)
	}
	return config, nil
}

func defaultConfig() *AntimonyConfig {
	return &AntimonyConfig{
		Deployment: DeploymentConfig{
			Provider: Containerlab,
		},
		Server: ServerConfig{
			Host: "127.0.0.1",
			Port: 3000,
		},
		Auth: AuthConfig{
			EnableNative:       true,
			EnableOpenID:       false,
			OpenIdIssuer:       "",
			OpenIdClientID:     "",
			OpenIdRedirectHost: "",
			OpenIdAdminGroups:  make([]string, 0),
		},
		Shell: ShellConfig{
			UserLimit: 20,
			Timeout:   1800,
		},
		Database: DatabaseConfig{
			Host:      "127.0.0.1",
			User:      "antimony",
			Database:  "antimony",
			Port:      5432,
			LocalFile: "./test.db",
		},
		Capture: CaptureConfig{
			Enabled:            true,
			SSHPort:            6969,
			SSHHost:            "0.0.0.0",
			SSHKeyPath:         "./key",
			ExcludedInterfaces: []string{"gway-2800", "monit_in", "lo", "mgmt0-0"},
		},
		Streaming: StreamingConfig{
			ContainerLogBacklog: 1000,
			ClabLogBacklog:      1000,
			ShellLinesBacklog:   1000,
		},
		FileSystem: FilesystemConfig{
			Storage: "./storage/",
			Run:     "./run/",
		},
		Containerlab: ClabConfig{
			SchemaUrl:      "https://raw.githubusercontent.com/srl-labs/containerlab/refs/heads/main/schemas/clab.schema.json",
			SchemaFallback: "./data/clab.schema.json",
			DeviceConfig:   "./data/device-config.json",
		},
	}
}

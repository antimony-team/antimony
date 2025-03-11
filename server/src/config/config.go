package config

import (
	"github.com/charmbracelet/log"
	"gopkg.in/yaml.v3"
	"os"
)

type (
	AntimonyConfig struct {
		Containerlab clabConfig
		Storage      storageConfig
		Server       serverConfig
		Database     databaseConfig
		Auth         authConfig
	}

	clabConfig struct {
		SchemaUrl      string `yaml:"schemaUrl"`
		SchemaFallback string `yaml:"schemaFallback"`
		DeviceConfig   string `yaml:"deviceConfig"`
	}

	storageConfig struct {
		Directory string `yaml:"directory"`
	}

	serverConfig struct {
		Host string `yaml:"host"`
		Port uint   `yaml:"port"`
	}

	authConfig struct {
		EnableNativeAdmin bool     `yaml:"enableNativeAdmin"`
		OpenIdIssuer      string   `yaml:"openIdIssuer"`
		OpenIdClientId    string   `yaml:"openIdClientId"`
		OpenIdAdminGroups []string `yaml:"openIdAdminGroups"`
	}

	databaseConfig struct {
		Host      string `yaml:"host"`
		Port      uint   `yaml:"port"`
		LocalFile string `yaml:"localFile"`
	}
)

func Load() *AntimonyConfig {
	config := defaultConfig()

	if configData, err := os.ReadFile("./config.yml"); err != nil {
		log.Warn("Failed to load ./config.yml.")
		data, err := yaml.Marshal(&config)
		err = os.WriteFile("./config.yml", data, 0755)
		if err != nil {
			log.Error("Failed to write default config to ./config.yml.")
		}
	} else if err := yaml.Unmarshal(configData, &config); err != nil {
		log.Errorf("Failed to parse config.yml: %v", err.Error())
	}

	return config
}

func defaultConfig() *AntimonyConfig {
	return &AntimonyConfig{
		Storage: storageConfig{
			Directory: "./storage/",
		},
		Server: serverConfig{
			Host: "127.0.0.1",
			Port: 3000,
		},
		Database: databaseConfig{
			Host:      "127.0.0.1",
			Port:      5432,
			LocalFile: "./test.db",
		},
		Containerlab: clabConfig{
			SchemaUrl:      "https://raw.githubusercontent.com/srl-labs/containerlab/refs/heads/main/schemas/clab.schema.json",
			SchemaFallback: "./data/clab.schema.json",
			DeviceConfig:   "./data/device-config.json",
		},
		Auth: authConfig{
			EnableNativeAdmin: true,
			OpenIdIssuer:      "",
			OpenIdClientId:    "",
			OpenIdAdminGroups: make([]string, 0),
		},
	}
}

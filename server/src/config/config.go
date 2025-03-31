package config

import (
	"github.com/charmbracelet/log"
	"gopkg.in/yaml.v3"
	"os"
)

type (
	AntimonyConfig struct {
		Containerlab clabConfig       `yaml:"containerlab"`
		FileSystem   filesystemConfig `yaml:"fileSystem"`
		Server       serverConfig     `yaml:"server"`
		Database     databaseConfig   `yaml:"database"`
		Auth         authConfig       `yaml:"auth"`
	}

	clabConfig struct {
		SchemaUrl      string `yaml:"schemaUrl"`
		SchemaFallback string `yaml:"schemaFallback"`
		DeviceConfig   string `yaml:"deviceConfig"`
	}

	filesystemConfig struct {
		Storage string `yaml:"storage"`
		Run     string `yaml:"run"`
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
		User      string `yaml:"user"`
		Database  string `yaml:"database"`
		Port      uint   `yaml:"port"`
		LocalFile string `yaml:"localFile"`
	}
)

func Load(fileName string) *AntimonyConfig {
	config := defaultConfig()

	if configData, err := os.ReadFile(fileName); err != nil {
		log.Warn("Failed to load configuration file.", "path", fileName)
		data, err := yaml.Marshal(&config)
		err = os.WriteFile(fileName, data, 0755)
		if err != nil {
			log.Error("Failed to write default configuration file.", "path", fileName)
		}
	} else if err := yaml.Unmarshal(configData, &config); err != nil {
		log.Error("Failed to parse configuration file.", "error", err.Error())
	}

	return config
}

func defaultConfig() *AntimonyConfig {
	return &AntimonyConfig{
		FileSystem: filesystemConfig{
			Storage: "./storage/",
			Run:     "./run/",
		},
		Server: serverConfig{
			Host: "127.0.0.1",
			Port: 3000,
		},
		Database: databaseConfig{
			Host:      "127.0.0.1",
			User:      "antimony",
			Database:  "antimony",
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

package config

import (
	"github.com/charmbracelet/log"
	"gopkg.in/yaml.v3"
	"os"
)

type (
	AntimonyConfig struct {
		Containerlab ClabConfig       `yaml:"containerlab"`
		FileSystem   FilesystemConfig `yaml:"fileSystem"`
		Server       ServerConfig     `yaml:"server"`
		Database     DatabaseConfig   `yaml:"database"`
		Auth         AuthConfig       `yaml:"auth"`
	}

	ClabConfig struct {
		SchemaUrl      string `yaml:"schemaUrl"`
		SchemaFallback string `yaml:"schemaFallback"`
		DeviceConfig   string `yaml:"deviceConfig"`
	}

	FilesystemConfig struct {
		Storage string `yaml:"storage"`
		Run     string `yaml:"run"`
	}

	ServerConfig struct {
		Host string `yaml:"host"`
		Port uint   `yaml:"port"`
	}

	AuthConfig struct {
		EnableNative       bool     `yaml:"enableNative"`
		EnableOpenId       bool     `yaml:"enableOpenId"`
		OpenIdIssuer       string   `yaml:"openIdIssuer"`
		OpenIdClientId     string   `yaml:"openIdClientId"`
		OpenIdRedirectHost string   `yaml:"openIdRedirectHost"`
		OpenIdAdminGroups  []string `yaml:"openIdAdminGroups"`
	}

	DatabaseConfig struct {
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
		FileSystem: FilesystemConfig{
			Storage: "./storage/",
			Run:     "./run/",
		},
		Server: ServerConfig{
			Host: "127.0.0.1",
			Port: 3000,
		},
		Database: DatabaseConfig{
			Host:      "127.0.0.1",
			User:      "antimony",
			Database:  "antimony",
			Port:      5432,
			LocalFile: "./test.db",
		},
		Containerlab: ClabConfig{
			SchemaUrl:      "https://raw.githubusercontent.com/srl-labs/containerlab/refs/heads/main/schemas/clab.schema.json",
			SchemaFallback: "./data/clab.schema.json",
			DeviceConfig:   "./data/device-config.json",
		},
		Auth: AuthConfig{
			EnableNative:       true,
			EnableOpenId:       false,
			OpenIdIssuer:       "",
			OpenIdClientId:     "",
			OpenIdRedirectHost: "",
			OpenIdAdminGroups:  make([]string, 0),
		},
	}
}

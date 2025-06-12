package config

import (
	"os"

	"github.com/charmbracelet/log"
	"gopkg.in/yaml.v3"
)

type (
	AntimonyConfig struct {
		General      GeneralConfig    `yaml:"general"`
		Server       ServerConfig     `yaml:"server"`
		Auth         AuthConfig       `yaml:"auth"`
		Shell        ShellConfig      `yaml:"shell"`
		Database     DatabaseConfig   `yaml:"database"`
		FileSystem   FilesystemConfig `yaml:"fileSystem"`
		Containerlab ClabConfig       `yaml:"containerlab"`
	}

	GeneralConfig struct {
		Provider string `yaml:"provider"`
	}

	ServerConfig struct {
		Host string `yaml:"host"`
		Port uint   `yaml:"port"`
	}

	AuthConfig struct {
		EnableNative       bool     `yaml:"enableNative"`
		EnableOpenID       bool     `yaml:"enableOpenId"`
		OpenIdIssuer       string   `yaml:"openIdIssuer"`
		OpenIdClientID     string   `yaml:"openIdClientId"`
		OpenIdRedirectHost string   `yaml:"openIdRedirectHost"`
		OpenIdAdminGroups  []string `yaml:"openIdAdminGroups"`
	}

	ShellConfig struct {
		UserLimit int   `yaml:"userLimit"`
		Timeout   int64 `yaml:"timeout"`
	}

	DatabaseConfig struct {
		Host      string `yaml:"host"`
		User      string `yaml:"user"`
		Database  string `yaml:"database"`
		Port      uint   `yaml:"port"`
		LocalFile string `yaml:"localFile"`
	}

	FilesystemConfig struct {
		Storage string `yaml:"storage"`
		Run     string `yaml:"run"`
	}

	ClabConfig struct {
		SchemaUrl      string `yaml:"schemaUrl"`
		SchemaFallback string `yaml:"schemaFallback"`
		DeviceConfig   string `yaml:"deviceConfig"`
	}
)

func Load(fileName string) *AntimonyConfig {
	config := defaultConfig()

	if configData, err := os.ReadFile(fileName); err != nil {
		log.Warn("Failed to load configuration file.", "path", fileName)
		var data []byte
		data, err = yaml.Marshal(&config)
		if err != nil {
			log.Error("Failed to marshal default configuration file.", "path", fileName)
		}

		//nolint:gosec // We need this file to be accessible
		err = os.WriteFile(fileName, data, 0750)
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
		General: GeneralConfig{
			Provider: "containerlab",
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

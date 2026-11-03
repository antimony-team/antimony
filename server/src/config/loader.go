package config

import (
	"errors"
	"fmt"
	"net/netip"
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
	if err := validate(config); err != nil {
		return nil, fmt.Errorf("invalid config %s: %w", fileName, err)
	}
	return config, nil
}

func validate(config *AntimonyConfig) error {
	return validateMgmt(config.Deployment.Mgmt)
}

func validateMgmt(mgmt MgmtConfig) error {
	if err := validatePool("deployment.mgmt.ipv4", mgmt.IPv4, true); err != nil {
		return err
	}
	if err := validatePool("deployment.mgmt.ipv6", mgmt.IPv6, false); err != nil {
		return err
	}

	// A lab network needs room for the gateway and at least one node
	if mgmt.IPv4Prefix < mgmt.IPv4.Bits() || mgmt.IPv4Prefix > 30 {
		return fmt.Errorf(
			"deployment.mgmt.ipv4Prefix must be between /%d (the size of deployment.mgmt.ipv4) and /30, not /%d",
			mgmt.IPv4.Bits(), mgmt.IPv4Prefix,
		)
	}
	if mgmt.IPv6Prefix < mgmt.IPv6.Bits() || mgmt.IPv6Prefix > 126 {
		return fmt.Errorf(
			"deployment.mgmt.ipv6Prefix must be between /%d (the size of deployment.mgmt.ipv6) and /126, not /%d",
			mgmt.IPv6.Bits(), mgmt.IPv6Prefix,
		)
	}

	// Every lab needs a network from both ranges, so the IPv6 range must hold at least as many as the IPv4 range
	if mgmt.IPv6Prefix-mgmt.IPv6.Bits() < mgmt.IPv4Prefix-mgmt.IPv4.Bits() {
		return fmt.Errorf(
			"deployment.mgmt.ipv6 holds fewer /%d networks than deployment.mgmt.ipv4 holds /%d networks",
			mgmt.IPv6Prefix, mgmt.IPv4Prefix,
		)
	}

	return nil
}

func validatePool(key string, pool netip.Prefix, isIPv4 bool) error {
	switch {
	case !pool.IsValid():
		return fmt.Errorf("%s must be set to a network, e.g. 10.200.0.0/16", key)
	case isIPv4 && !pool.Addr().Is4():
		return fmt.Errorf("%s must be an IPv4 network, not %s", key, pool)
	case !isIPv4 && (!pool.Addr().Is6() || pool.Addr().Is4In6()):
		return fmt.Errorf("%s must be an IPv6 network, not %s", key, pool)
	case pool.Masked() != pool:
		return fmt.Errorf("%s has host bits set, did you mean %s?", key, pool.Masked())
	}

	return nil
}

func defaultConfig() *AntimonyConfig {
	return &AntimonyConfig{
		Deployment: DeploymentConfig{
			Provider: DeploymentProviders.Containerlab,
			Mgmt: MgmtConfig{
				IPv4:       netip.MustParsePrefix("10.200.0.0/16"),
				IPv4Prefix: 24,
				IPv6:       netip.MustParsePrefix("fd00:200::/48"),
				IPv6Prefix: 64,
			},
		},
		Server: ServerConfig{
			Host: "127.0.0.1",
			Port: 3000,
		},
		Auth: AuthConfig{
			Methods:            []AuthMethod{AuthMethods.Admin},
			OpenIdIssuer:       "",
			OpenIdClientID:     "",
			OpenIdRedirectHost: "",
			OpenIdAdminGroups:  make([]string, 0),
		},
		Security: SecurityConfig{
			TopologyPolicy:       true,
			AllowedImagePrefixes: make([]string, 0),
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
			LocalFile: "./db/antimony.db",
		},
		SSH: SSHConfig{
			Enabled:    true,
			SSHHost:    "127.0.0.1",
			SSHPort:    6969,
			SSHKeyPath: "./key",
		},
		Capture: CaptureConfig{
			Enabled:            true,
			ExcludedInterfaces: []string{"lo", "gway-*", "monit_in", "mgmt0*", "c9s*"},
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
			SchemaUrl:                 "https://raw.githubusercontent.com/srl-labs/containerlab/refs/heads/main/schemas/clab.schema.json",
			SchemaFallback:            "./data/clab.schema.json",
			AnnotationsSchemaUrl:      "",
			AnnotationsSchemaFallback: "./data/clab.annotations.schema.json",
			DeviceConfig:              "./data/device-config.json",
			KindsConfig:               "./kinds.conf.yml",
		},
	}
}

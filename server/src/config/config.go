package config

import (
	"fmt"
	"strings"
)

type AntimonyConfig struct {
	Server       ServerConfig     `yaml:"server"`
	Deployment   DeploymentConfig `yaml:"deployment"`
	Auth         AuthConfig       `yaml:"auth"`
	Shell        ShellConfig      `yaml:"shell"`
	Database     DatabaseConfig   `yaml:"database"`
	Capture      CaptureConfig    `yaml:"capture"`
	Streaming    StreamingConfig  `yaml:"streaming"`
	FileSystem   FilesystemConfig `yaml:"fileSystem"`
	Containerlab ClabConfig       `yaml:"containerlab"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port uint   `yaml:"port"`
}

type DeploymentProvider int

const (
	Containerlab DeploymentProvider = iota
	Clabernetes
)

var deploymentProviderNames = map[string]DeploymentProvider{
	"containerlab": Containerlab,
	"clabernetes":  Clabernetes,
}

var deploymentProviderStrings = func() map[DeploymentProvider]string {
	m := make(map[DeploymentProvider]string, len(deploymentProviderNames))
	for name, p := range deploymentProviderNames {
		m[p] = name
	}
	return m
}()

func ParseDeploymentProvider(s string) (DeploymentProvider, error) {
	p, ok := deploymentProviderNames[strings.ToLower(strings.TrimSpace(s))]
	if !ok {
		return 0, fmt.Errorf("unknown deployment provider: %q", s)
	}
	return p, nil
}

func (p DeploymentProvider) String() string {
	if s, ok := deploymentProviderStrings[p]; ok {
		return s
	}
	return fmt.Sprintf("DeploymentProvider(%d)", int(p))
}

func (p DeploymentProvider) MarshalText() ([]byte, error) {
	s, ok := deploymentProviderStrings[p]
	if !ok {
		return nil, fmt.Errorf("invalid deployment provider: %d", int(p))
	}
	return []byte(s), nil
}

func (p *DeploymentProvider) UnmarshalText(b []byte) error {
	v, err := ParseDeploymentProvider(string(b))
	if err != nil {
		return err
	}
	*p = v
	return nil
}

type DeploymentConfig struct {
	Provider DeploymentProvider `yaml:"provider"`
}

type CaptureConfig struct {
	Enabled            bool     `yaml:"enabled"`
	SSHHost            string   `yaml:"sshHost"`
	SSHPort            int      `yaml:"sshPort"`
	SSHKeyPath         string   `yaml:"sshKeyPath"`
	ExcludedInterfaces []string `yaml:"excludedInterfaces"`
}

type StreamingConfig struct {
	ContainerLogBacklog int `yaml:"containerLogBacklog"`
	ClabLogBacklog      int `yaml:"clabLogBacklog"`
	ShellLinesBacklog   int `yaml:"shellLinesBacklog"`
}

type AuthConfig struct {
	EnableNative       bool     `yaml:"enableNative"`
	EnableOpenID       bool     `yaml:"enableOpenId"`
	OpenIdIssuer       string   `yaml:"openIdIssuer"`
	OpenIdClientID     string   `yaml:"openIdClientId"`
	OpenIdRedirectHost string   `yaml:"openIdRedirectHost"`
	OpenIdAdminGroups  []string `yaml:"openIdAdminGroups"`
}

type ShellConfig struct {
	UserLimit int   `yaml:"userLimit"`
	Timeout   int64 `yaml:"timeout"`
}

type DatabaseConfig struct {
	Host      string `yaml:"host"`
	User      string `yaml:"user"`
	Database  string `yaml:"database"`
	Port      uint   `yaml:"port"`
	LocalFile string `yaml:"localFile"`
}

type FilesystemConfig struct {
	Storage string `yaml:"storage"`
	Run     string `yaml:"run"`
}

type ClabConfig struct {
	SchemaUrl      string `yaml:"schemaUrl"`
	SchemaFallback string `yaml:"schemaFallback"`
	DeviceConfig   string `yaml:"deviceConfig"`
}
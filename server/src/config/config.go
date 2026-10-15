package config

import "github.com/antimony-team/antimony-server/utils"

type AntimonyConfig struct {
	Server       ServerConfig     `yaml:"server"`
	Deployment   DeploymentConfig `yaml:"deployment"`
	Auth         AuthConfig       `yaml:"auth"`
	Security     SecurityConfig   `yaml:"security"`
	Shell        ShellConfig      `yaml:"shell"`
	Database     DatabaseConfig   `yaml:"database"`
	SSH          SSHConfig        `yaml:"ssh"`
	Capture      CaptureConfig    `yaml:"capture"`
	Streaming    StreamingConfig  `yaml:"streaming"`
	FileSystem   FilesystemConfig `yaml:"filesystem"`
	Containerlab ClabConfig       `yaml:"containerlab"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port uint   `yaml:"port"`
}

type DeploymentProvider string

const (
	containerlab DeploymentProvider = "containerlab"
	clabernetes  DeploymentProvider = "clabernetes"
	dummy        DeploymentProvider = "dummy"
)

var DeploymentProviders = struct {
	Containerlab DeploymentProvider
	Clabernetes  DeploymentProvider
	Dummy        DeploymentProvider
}{
	Containerlab: containerlab,
	Clabernetes:  clabernetes,
	Dummy:        dummy,
}

func (p *DeploymentProvider) UnmarshalText(b []byte) error {
	parsed, err := utils.ParseEnum("deployment provider", string(b), containerlab, clabernetes, dummy)
	*p = parsed
	return err
}

type AuthMethod string

const (
	authAdmin   AuthMethod = "admin"
	authOpenID  AuthMethod = "openid"
	authDesktop AuthMethod = "desktop"
)

var AuthMethods = struct {
	Admin   AuthMethod
	OpenID  AuthMethod
	Desktop AuthMethod
}{
	Admin:   authAdmin,
	OpenID:  authOpenID,
	Desktop: authDesktop,
}

func (m *AuthMethod) UnmarshalText(b []byte) error {
	parsed, err := utils.ParseEnum("auth method", string(b), authAdmin, authOpenID, authDesktop)
	*m = parsed
	return err
}

type DeploymentConfig struct {
	Provider DeploymentProvider `yaml:"provider"`
}

type SSHConfig struct {
	Enabled    bool   `yaml:"enabled"`
	SSHHost    string `yaml:"sshHost"`
	SSHPort    int    `yaml:"sshPort"`
	SSHKeyPath string `yaml:"sshKeyPath"`
}

type CaptureConfig struct {
	Enabled            bool     `yaml:"enabled"`
	ExcludedInterfaces []string `yaml:"excludedInterfaces"`
}

type StreamingConfig struct {
	ContainerLogBacklog int `yaml:"containerLogBacklog"`
	ClabLogBacklog      int `yaml:"clabLogBacklog"`
	ShellLinesBacklog   int `yaml:"shellLinesBacklog"`
}

type AuthConfig struct {
	Methods            []AuthMethod `yaml:"methods"`
	OpenIdIssuer       string       `yaml:"openIdIssuer"`
	OpenIdClientID     string       `yaml:"openIdClientId"`
	OpenIdRedirectHost string       `yaml:"openIdRedirectHost"`
	OpenIdAdminGroups  []string     `yaml:"openIdAdminGroups"`
}

type SecurityConfig struct {
	TopologyPolicy       bool     `yaml:"topologyPolicy"`
	AllowedImagePrefixes []string `yaml:"allowedImagePrefixes"`
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
	SchemaUrl                 string `yaml:"schemaUrl"`
	SchemaFallback            string `yaml:"schemaFallback"`
	AnnotationsSchemaUrl      string `yaml:"annotationsSchemaUrl"`
	AnnotationsSchemaFallback string `yaml:"annotationsSchemaFallback"`
	DeviceConfig              string `yaml:"deviceConfig"`

	// KindsConfig is the path to the node kind configuration file. See the shipped kinds.conf.yml for the
	// supported fields. If the file is missing, all node kinds fall back to their defaults.
	KindsConfig string `yaml:"kindsConfig"`
}

package serverconfig

type ServerConfig struct {
	SSHConfig        SSHConfig        `json:"ssh"`
	CaptureConfig    CaptureConfig    `json:"capture"`
	DeploymentConfig DeploymentConfig `json:"deployment"`
}

type SSHConfig struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
}

type CaptureConfig struct {
	Enabled            bool     `json:"enabled"`
	ExcludedInterfaces []string `json:"excludedInterfaces"`
}

type DeploymentConfig struct {
	Provider string `json:"provider"`
}

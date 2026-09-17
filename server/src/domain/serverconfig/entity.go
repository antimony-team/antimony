package serverconfig

type ServerConfig struct {
	CaptureConfig    CaptureConfig    `json:"capture"`
	DeploymentConfig DeploymentConfig `json:"deployment"`
}

type DeploymentConfig struct {
	Provider string `json:"provider"`
}

type CaptureConfig struct {
	Enabled            bool     `json:"enabled"`
	Port               int      `json:"port"`
	ExcludedInterfaces []string `json:"excludedInterfaces"`
}

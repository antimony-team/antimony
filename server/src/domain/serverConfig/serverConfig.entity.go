package serverConfig

type ServerConfig struct {
	CaptureConfig CaptureConfig `json:"capture"`
}

type CaptureConfig struct {
	Enabled            bool     `json:"enabled"`
	Port               int      `json:"port"`
	ExcludedInterfaces []string `json:"excludedInterfaces"`
}

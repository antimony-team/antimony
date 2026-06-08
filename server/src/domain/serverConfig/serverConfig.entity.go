package serverConfig

type ServerConfigOut struct {
	CaptureConfig captureConfigOut `json:"capture"`
}

type captureConfigOut struct {
	Enabled            bool     `json:"enabled"`
	Port               int      `json:"port"`
	ExcludedInterfaces []string `json:"excludedInterfaces"`
}

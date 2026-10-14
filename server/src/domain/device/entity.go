package device

type DeviceConfig struct {
	Kind string `json:"kind"`

	// KindAliases are the other names containerlab accepts for the kind, e.g. srl
	KindAliases []string `json:"kindAliases,omitempty"`
	Name        string   `json:"name"`

	// Interfaces name the same interfaces, new interfaces are named after the first one
	Interfaces []InterfacePattern `json:"interfaces"`
	Images     []string           `json:"images"`
}

// InterfacePattern is a way to name the interfaces of a device; $ stands for the
// number of the interface, e.g., e1-$. Start is the number of the first interface.
type InterfacePattern struct {
	Pattern string `json:"pattern"`
	Start   uint   `json:"start"`
}

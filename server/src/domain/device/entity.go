package device

type DeviceConfig struct {
	Kind             string `json:"kind"`
	Name             string `json:"name"`
	InterfacePattern string `json:"interfacePattern"`
	InterfaceStart   uint   `json:"interfaceStart"`
}

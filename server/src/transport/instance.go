package transport

import (
	"antimonyBackend/runtime/instance"
	"time"
)

type InstanceOut struct {
	Name              string                   `json:"name"`
	Deployed          time.Time                `json:"deployed"`
	State             instance.InstanceState   `json:"state"`
	LatestStateChange time.Time                `json:"latestStateChange"`
	Nodes             []*instance.InstanceNode `json:"nodes"`
	IsRecovered       bool                     `json:"isRecovered"`
}

func InstanceToOut(instance *instance.Instance, instanceName string) *InstanceOut {
	return &InstanceOut{
		Name:              instanceName,
		Deployed:          instance.Deployed,
		State:             instance.State,
		LatestStateChange: instance.LatestStateChange,
		Nodes:             instance.Nodes,
		IsRecovered:       instance.Recovered,
	}
}

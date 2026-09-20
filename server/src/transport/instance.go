package transport

import (
	"antimonyBackend/runtime/instance"
	"slices"
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

func InstanceToOut(inst *instance.Instance, instanceName string) *InstanceOut {
	inst.DataMutex.Lock()
	defer inst.DataMutex.Unlock()

	nodes := make([]*instance.InstanceNode, len(inst.Nodes))
	for i, node := range inst.Nodes {
		nodeCopy := *node
		nodeCopy.Interfaces = slices.Clone(node.Interfaces)
		nodes[i] = &nodeCopy
	}

	return &InstanceOut{
		Name:              instanceName,
		Deployed:          inst.Deployed,
		State:             inst.State,
		LatestStateChange: inst.LatestStateChange,
		Nodes:             nodes,
		IsRecovered:       inst.Recovered,
	}
}

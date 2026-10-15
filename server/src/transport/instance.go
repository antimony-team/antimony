package transport

import (
	"antimonyBackend/runtime/instance"
	"slices"
	"strings"
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

	nodes := make([]*instance.InstanceNode, 0, len(inst.Nodes))
	for _, node := range inst.Nodes {
		nodeCopy := *node
		nodeCopy.Interfaces = slices.Clone(node.Interfaces)
		nodes = append(nodes, &nodeCopy)
	}

	// Map iteration order is random; the API returns the nodes sorted by name
	slices.SortFunc(nodes, func(a, b *instance.InstanceNode) int {
		return strings.Compare(a.Name, b.Name)
	})

	return &InstanceOut{
		Name:              instanceName,
		Deployed:          inst.Deployed,
		State:             inst.State,
		LatestStateChange: inst.LatestStateChange,
		Nodes:             nodes,
		IsRecovered:       inst.Recovered,
	}
}

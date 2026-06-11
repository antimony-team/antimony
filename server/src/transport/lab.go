package transport

import (
	"antimonyBackend/domain/lab"
	"antimonyBackend/runtime/instance"
	"time"
)

type LabOut struct {
	ID                 string       `json:"id"`
	Name               string       `json:"name"`
	StartTime          time.Time    `json:"startTime"`
	EndTime            *time.Time   `json:"endTime"`
	TopologyId         string       `json:"topologyId"`
	CollectionId       string       `json:"collectionId"`
	Creator            UserOut      `json:"creator"`
	TopologyDefinition string       `json:"topologyDefinition"`
	Instance           *InstanceOut `json:"instance,omitempty"     extensions:"x-nullable"`
	InstanceName       string       `json:"instanceName,omitempty" extensions:"x-nullable"`
}

func LabToOut(lab *lab.Lab, instance *instance.Instance) *LabOut {
	var instanceOut *InstanceOut
	if instance != nil {
		instanceOut = InstanceToOut(instance, lab.InstanceName)
	}

	return &LabOut{
		ID:                 lab.UUID,
		Name:               lab.Name,
		StartTime:          lab.StartTime,
		EndTime:            lab.EndTime,
		TopologyId:         lab.Topology.UUID,
		CollectionId:       lab.Topology.Collection.UUID,
		Creator:            UserToOut(&lab.Creator),
		TopologyDefinition: *lab.TopologyDefinition,
		Instance:           instanceOut,
		InstanceName:       lab.InstanceName,
	}
}

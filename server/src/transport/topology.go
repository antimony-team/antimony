package transport

import (
	"antimonyBackend/domain/topology"

	"github.com/samber/lo"
)

type TopologyOut struct {
	ID               string        `json:"id"`
	Definition       string        `json:"definition"`
	SyncUrl          string        `json:"syncUrl"`
	CollectionId     string        `json:"collectionId"`
	Creator          UserOut       `json:"creator"`
	BindFiles        []BindFileOut `json:"bindFiles"`
	LastDeployFailed bool          `json:"lastDeployFailed"`
}

type BindFileOut struct {
	ID         string `json:"id"`
	Content    string `json:"content"`
	FilePath   string `json:"filePath"`
	TopologyId string `json:"topologyId"`
}

func TopologyToOut(topologyFull *topology.TopologyFull) *TopologyOut {
	bindFilesOut := lo.Map(topologyFull.BindFiles, func(bindFile topology.BindFileFull, _ int) BindFileOut {
		return *BindFileToOut(&bindFile)
	})

	return &TopologyOut{
		ID:               topologyFull.ID,
		Definition:       topologyFull.Definition,
		SyncUrl:          topologyFull.SyncUrl,
		CollectionId:     topologyFull.Collection.UUID,
		Creator:          UserToOut(&topologyFull.Creator),
		BindFiles:        bindFilesOut,
		LastDeployFailed: topologyFull.LastDeployFailed,
	}
}

func BindFileToOut(bindFileFull *topology.BindFileFull) *BindFileOut {
	return &BindFileOut{
		ID:         bindFileFull.ID,
		Content:    bindFileFull.Content,
		FilePath:   bindFileFull.FilePath,
		TopologyId: bindFileFull.Topology.UUID,
	}
}

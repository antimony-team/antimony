package transport

import (
	"github.com/samber/lo"

	"github.com/antimony-team/antimony-server/domain/topology"
	"github.com/antimony-team/antimony-server/policy"
)

type TopologyOut struct {
	ID               string           `json:"id"`
	Definition       string           `json:"definition"`
	Annotations      string           `json:"annotations"`
	SyncUrl          string           `json:"syncUrl"`
	CollectionId     string           `json:"collectionId"`
	Creator          UserOut          `json:"creator"`
	BindFiles        []BindFileOut    `json:"bindFiles"`
	LastDeployFailed bool             `json:"lastDeployFailed"`
	PolicyFindings   []policy.Finding `json:"policyFindings"`
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
		Annotations:      topologyFull.Annotations,
		SyncUrl:          topologyFull.SyncUrl,
		CollectionId:     topologyFull.Collection.UUID,
		Creator:          UserToOut(&topologyFull.Creator),
		BindFiles:        bindFilesOut,
		LastDeployFailed: topologyFull.LastDeployFailed,
		PolicyFindings:   topologyFull.PolicyFindings,
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

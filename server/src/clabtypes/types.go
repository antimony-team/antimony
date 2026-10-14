package clabtypes

import "github.com/srl-labs/containerlab/types"

// TopologyDefinition is the part of a containerlab topology file Antimony reads.
type TopologyDefinition struct {
	Name     string          `yaml:"name"`
	Topology *types.Topology `yaml:"topology"`
}

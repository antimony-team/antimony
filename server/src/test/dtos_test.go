package test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The DTOs below mirror the transport package's output types, with one deliberate difference: node
// state is decoded as a plain int.
//
// transport.LabOut cannot decode the API's own response. deployment.NodeState implements
// UnmarshalText (so containerlab's string states like "running" can be parsed out of its inspect
// output) but has no matching MarshalText or MarshalJSON, so encoding/json writes it as a number
// and then refuses to read that number back:
//
//	json: cannot unmarshal number into Go struct field ... of type deployment.NodeState:
//	JSON value must be string type
//
// See TestInstanceOut_NodeStateDoesNotRoundTrip, which pins that asymmetry.

// labDTO mirrors transport.LabOut.
type labDTO struct {
	ID                 string       `json:"id"`
	Name               string       `json:"name"`
	StartTime          time.Time    `json:"startTime"`
	EndTime            *time.Time   `json:"endTime"`
	TopologyId         string       `json:"topologyId"`
	CollectionId       string       `json:"collectionId"`
	Creator            userDTO      `json:"creator"`
	TopologyDefinition string       `json:"topologyDefinition"`
	Instance           *instanceDTO `json:"instance"`
}

// userDTO mirrors transport.UserOut.
type userDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// instanceDTO mirrors transport.InstanceOut.
type instanceDTO struct {
	Name              string    `json:"name"`
	Deployed          time.Time `json:"deployed"`
	State             int       `json:"state"`
	LatestStateChange time.Time `json:"latestStateChange"`
	Nodes             []nodeDTO `json:"nodes"`
	IsRecovered       bool      `json:"isRecovered"`
}

// nodeDTO mirrors instance.InstanceNode.
type nodeDTO struct {
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	IPv4          string         `json:"ipv4"`
	IPv6          string         `json:"ipv6"`
	State         int            `json:"state"`
	IsReady       bool           `json:"isReady"`
	ContainerId   string         `json:"containerId"`
	ContainerName string         `json:"containerName"`
	Interfaces    []interfaceDTO `json:"interfaces"`
	CanRestart    bool           `json:"canRestart"`
}

// interfaceDTO mirrors deployment.NodeInterface.
type interfaceDTO struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	MTU     int    `json:"mtu"`
	State   string `json:"state"`
}

/*
 * Lookup helpers.
 */

func labIDs(labs []labDTO) []string {
	ids := make([]string, 0, len(labs))
	for _, item := range labs {
		ids = append(ids, item.ID)
	}

	return ids
}

func labNames(labs []labDTO) []string {
	names := make([]string, 0, len(labs))
	for _, item := range labs {
		names = append(names, item.Name)
	}

	return names
}

func findLab(t *testing.T, labs []labDTO, id string) labDTO {
	t.Helper()

	for _, item := range labs {
		if item.ID == id {
			return item
		}
	}

	t.Fatalf("lab %q not found in %v", id, labIDs(labs))

	return labDTO{}
}

func findNode(t *testing.T, nodes []nodeDTO, name string) nodeDTO {
	t.Helper()

	for _, node := range nodes {
		if node.Name == name {
			return node
		}
	}

	names := make([]string, 0, len(nodes))
	for _, node := range nodes {
		names = append(names, node.Name)
	}

	t.Fatalf("node %q not found in %v", name, names)

	return nodeDTO{}
}

func nodeNames(nodes []nodeDTO) []string {
	names := make([]string, 0, len(nodes))
	for _, node := range nodes {
		names = append(names, node.Name)
	}

	return names
}

func interfaceNames(interfaces []interfaceDTO) []string {
	names := make([]string, 0, len(interfaces))
	for _, item := range interfaces {
		names = append(names, item.Name)
	}

	return names
}

// toJSON re-encodes a decoded value, for comparing against a raw JSON string.
func toJSON(t *testing.T, value any) string {
	t.Helper()

	encoded, err := json.Marshal(value)
	require.NoError(t, err)

	return string(encoded)
}

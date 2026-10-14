package test

import (
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/topology"
	"antimonyBackend/policy"
	"antimonyBackend/transport"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The policy engine has its own tests for its rules, these check that the findings reach the client and
// follow the topology as it changes.

const unsafeTopologyDefinition = `name: unsafe-topo
topology:
  nodes:
    r1:
      kind: linux
      image: alpine:3.20
      privileged: true
      startup-config: configs/r1.cfg
  links:
    - endpoints: ["r1:eth1", "host:veth-r1"]
`

// createTopology creates a topology in the public collection and returns its ID.
func createTopology(t *testing.T, h *Harness, definition string) string {
	t.Helper()

	var topologyId string
	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(definition),
		Annotations:  ptr(EmptyTopologyAnnotations),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicBoth.UUID),
	}, h.Seed.Admin.Token).RequireOk(&topologyId)

	return topologyId
}

// findingsOf returns the findings of a topology as "rule@path".
func findingsOf(t *testing.T, h *Harness, topologyId string) []string {
	t.Helper()

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+topologyId, h.Seed.Admin.Token).RequireOk(&topologyOut)

	return findingKeys(topologyOut.PolicyFindings)
}

func findingKeys(findings []policy.Finding) []string {
	keys := make([]string, 0, len(findings))
	for _, finding := range findings {
		keys = append(keys, fmt.Sprintf("%s@%s", finding.RuleId, finding.Path))
	}
	return keys
}

func TestTopologyPolicy_SafeTopologiesHaveNoFindings(t *testing.T) {
	h := NewHarness(t)

	for _, topologyId := range []string{TopologyAdminID, TopologyMemberID, TopologyPrivateID, TopologyHiddenID} {
		assert.Emptyf(t, findingsOf(t, h, topologyId), "the seeded topology %s only uses safe features", topologyId)
	}
}

func TestTopologyPolicy_FindingsAreReturnedWithTheTopology(t *testing.T) {
	h := NewHarness(t)
	topologyId := createTopology(t, h, unsafeTopologyDefinition)

	assert.ElementsMatch(t, []string{
		"privileged@topology.nodes.r1.privileged",
		"foreign-file@topology.nodes.r1.startup-config",
		"host-link@topology.links[0]",
	}, findingsOf(t, h, topologyId))

	t.Run("with every field the client needs", func(t *testing.T) {
		var topologyOut transport.TopologyOut
		h.GET("/topologies/"+topologyId, h.Seed.Admin.Token).RequireOk(&topologyOut)

		for _, finding := range topologyOut.PolicyFindings {
			assert.NotEmpty(t, finding.RuleId)
			assert.NotEmpty(t, finding.Impact)
			assert.NotEmpty(t, finding.Message)
		}
	})

	t.Run("in the list of topologies as well", func(t *testing.T) {
		var topologies []transport.TopologyOut
		h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&topologies)

		for _, topologyOut := range topologies {
			if topologyOut.ID == topologyId {
				assert.Len(t, topologyOut.PolicyFindings, 3)
				return
			}
		}
		t.Fatal("the topology is missing from the list")
	})
}

func TestTopologyPolicy_FindingsFollowTheDefinition(t *testing.T) {
	h := NewHarness(t)
	topologyId := createTopology(t, h, unsafeTopologyDefinition)
	require.Len(t, findingsOf(t, h, topologyId), 3)

	h.PATCH("/topologies/"+topologyId, topology.TopologyInPartial{
		Definition: ptr("name: unsafe-topo\ntopology:\n  nodes:\n    r1:\n      kind: linux\n"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	assert.Empty(t, findingsOf(t, h, topologyId), "the findings of the old definition must not be returned")
}

// A file reference is only safe if it names one of the topology's own files, so the findings change
// with the bind files even if the definition stays the same.
func TestTopologyPolicy_FindingsFollowTheBindFiles(t *testing.T) {
	h := NewHarness(t)
	topologyId := createTopology(t, h,
		"name: files-topo\ntopology:\n  nodes:\n    r1:\n      kind: linux\n      startup-config: configs/r1.cfg\n")

	require.Equal(t, []string{"foreign-file@topology.nodes.r1.startup-config"}, findingsOf(t, h, topologyId))

	var bindFileId string
	h.POST(bindFileURL(topologyId), topology.BindFileIn{
		FilePath: ptr("configs/r1.cfg"),
		Content:  ptr("hostname r1"),
	}, h.Seed.Admin.Token).RequireOk(&bindFileId)

	assert.Empty(t, findingsOf(t, h, topologyId), "the startup config is one of the topology's files now")

	h.DELETE(bindFileItemURL(topologyId, bindFileId), h.Seed.Admin.Token).RequireOk(nil)

	assert.Equal(t, []string{"foreign-file@topology.nodes.r1.startup-config"}, findingsOf(t, h, topologyId),
		"without the file the reference is foreign again")
}

func TestTopologyPolicy_ImagesOutsideTheAllowlistAreFindings(t *testing.T) {
	h := NewHarness(t, WithAllowedImagePrefixes("ghcr.io/nokia/"))
	topologyId := createTopology(t, h, `name: images-topo
topology:
  nodes:
    srl:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux
    host:
      kind: linux
      image: alpine:3.20
`)

	assert.Equal(t, []string{"image-not-allowed@topology.nodes.host.image"}, findingsOf(t, h, topologyId))
}

func TestTopologyPolicy_AnEmptyAllowlistAllowsEveryImage(t *testing.T) {
	h := NewHarness(t, WithAllowedImagePrefixes())
	topologyId := createTopology(t, h,
		"name: any-image\ntopology:\n  nodes:\n    host:\n      kind: linux\n      image: example.com/anything:1\n")

	assert.Empty(t, findingsOf(t, h, topologyId))
}

/*
 * Lab creation. Members may only deploy topologies without findings, admins may deploy every topology.
 */

const unsafeTopologyErrorCode = 3005

// createLabOf creates a lab of the given topology and returns the response.
func createLabOf(h *Harness, topologyId string, name string, token string) *Response {
	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	return h.POST("/labs", lab.LabIn{
		Name:       ptr(name),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(topologyId),
	}, token)
}

// labsOfTopology returns how many labs the topology has.
func labsOfTopology(t *testing.T, h *Harness, topologyId string) int {
	t.Helper()

	var labs []transport.LabOut
	h.GET("/labs"+allLabs, h.Seed.Admin.Token).RequireOk(&labs)

	count := 0
	for _, labOut := range labs {
		if labOut.TopologyId != nil && *labOut.TopologyId == topologyId {
			count++
		}
	}
	return count
}

func TestCreateLab_MemberCannotDeployAnUnsafeTopology(t *testing.T) {
	h := NewHarness(t)
	topologyId := createTopology(t, h, unsafeTopologyDefinition)

	createLabOf(h, topologyId, "Unsafe", h.Seed.Member.Token).
		RequireError(http.StatusBadRequest, unsafeTopologyErrorCode)

	assert.Zero(t, labsOfTopology(t, h, topologyId), "no lab must be created")
}

func TestCreateLab_AdminCanDeployAnUnsafeTopology(t *testing.T) {
	h := NewHarness(t)
	topologyId := createTopology(t, h, unsafeTopologyDefinition)

	createLabOf(h, topologyId, "Unsafe", h.Seed.Admin.Token).RequireOk(nil)

	assert.Equal(t, 1, labsOfTopology(t, h, topologyId))
}

func TestCreateLab_MemberCannotDeployAnImageOutsideTheAllowlist(t *testing.T) {
	h := NewHarness(t, WithAllowedImagePrefixes("ghcr.io/nokia/"))

	// The seeded topology runs alpine next to SR Linux
	createLabOf(h, TopologyAdminID, "Alpine", h.Seed.Member.Token).
		RequireError(http.StatusBadRequest, unsafeTopologyErrorCode)

	createLabOf(h, TopologyAdminID, "Alpine", h.Seed.Admin.Token).RequireOk(nil)
}

// The check reads the topology's bind files, so a file reference stops blocking members once the file is one of
// the topology's own.
func TestCreateLab_MemberCanDeployOnceTheReferencedFileIsTheTopologysOwn(t *testing.T) {
	h := NewHarness(t)
	topologyId := createTopology(t, h,
		"name: files-topo\ntopology:\n  nodes:\n    r1:\n      kind: linux\n      startup-config: configs/r1.cfg\n")

	createLabOf(h, topologyId, "Before", h.Seed.Member.Token).
		RequireError(http.StatusBadRequest, unsafeTopologyErrorCode)

	h.POST(bindFileURL(topologyId), topology.BindFileIn{
		FilePath: ptr("configs/r1.cfg"),
		Content:  ptr("hostname r1"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	createLabOf(h, topologyId, "After", h.Seed.Member.Token).RequireOk(nil)
	assert.Equal(t, 1, labsOfTopology(t, h, topologyId))
}

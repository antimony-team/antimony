package test

import (
	"antimonyBackend/domain/topology"
	"antimonyBackend/transport"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A definition with a name that does not collide with any seeded topology.
const freshTopologyDefinition = `name: fresh-topo
topology:
  nodes:
    host1:
      kind: linux
      image: alpine:latest
`

/*
 * GET /topologies
 */

func TestGetTopologies_AdminSeesEverything(t *testing.T) {
	h := NewHarness(t)

	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&topologies)

	assert.ElementsMatch(t, []string{
		TopologyAdminID, TopologyMemberID, TopologyPrivateID, TopologyHiddenID,
	}, topologyIDs(topologies))
}

func TestGetTopologies_MemberOnlySeesItsCollections(t *testing.T) {
	h := NewHarness(t)

	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.Member.Token).RequireOk(&topologies)

	ids := topologyIDs(topologies)

	assert.ElementsMatch(t, []string{TopologyAdminID, TopologyMemberID, TopologyPrivateID}, ids)
	assert.NotContains(t, ids, TopologyHiddenID, "the hidden collection must stay hidden")
}

func TestGetTopologies_OutsiderSeesAnEmptyList(t *testing.T) {
	h := NewHarness(t)

	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.Outsider.Token).RequireOk(&topologies)

	assert.Empty(t, topologies)
}

func TestGetTopologies_CarriesDefinitionCreatorAndBindFiles(t *testing.T) {
	h := NewHarness(t)

	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&topologies)

	found := findTopology(t, topologies, TopologyAdminID)

	assert.Equal(t, AdminTopologyDefinition, found.Definition)
	assert.Equal(t, h.Seed.PublicBoth.UUID, found.CollectionId)
	assert.Equal(t, h.Seed.Admin.ID(), found.Creator.ID)
	assert.False(t, found.LastDeployFailed)
	assert.Empty(t, found.SyncUrl)

	require.Len(t, found.BindFiles, 1)
	assert.Equal(t, BindFileID, found.BindFiles[0].ID)
	assert.Equal(t, BindFileContent, found.BindFiles[0].Content)
	assert.Equal(t, TopologyAdminID, found.BindFiles[0].TopologyId)
}

func TestGetTopologies_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.GET("/topologies", "").RequireError(http.StatusUnauthorized, 401)
	h.GET("/topologies", "garbage").RequireError(498, 498)
}

/*
 * GET /topologies/:topologyId
 */

func TestGetTopologyByUuid_ReturnsTheTopology(t *testing.T) {
	h := NewHarness(t)

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)

	assert.Equal(t, TopologyAdminID, topologyOut.ID)
	assert.Equal(t, AdminTopologyDefinition, topologyOut.Definition)
}

func TestGetTopologyByUuid_MemberCanReadOneInItsCollections(t *testing.T) {
	h := NewHarness(t)

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Member.Token).RequireOk(&topologyOut)

	assert.Equal(t, TopologyAdminID, topologyOut.ID)
}

// TestGetTopologyByUuid_InaccessibleTopologyIsForbidden covers the access check on a single
// topology.
//
// This used to be masked as a 404 to stop existence probing, but the IDs are server-generated
// UUIDs so that bought very little, and it made the topology and lab endpoints disagree about the
// same situation. Both now answer 403 with a real message.
func TestGetTopologyByUuid_InaccessibleTopologyIsForbidden(t *testing.T) {
	h := NewHarness(t)

	errorResponse := h.GET("/topologies/"+TopologyHiddenID, h.Seed.Member.Token).
		RequireError(http.StatusForbidden, 403)

	assert.Contains(t, errorResponse.Message, "access to the provided topology is not granted")
}

func TestGetTopologyByUuid_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.GET("/topologies/does-not-exist", h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

/*
 * POST /topologies
 */

func TestCreateTopology_AdminCanCreateAnywhere(t *testing.T) {
	h := NewHarness(t)

	var createdID string
	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr("https://example.com/topo.yml"),
		CollectionId: ptr(h.Seed.Hidden.UUID),
	}, h.Seed.AdminBare.Token).RequireOk(&createdID)

	require.NotEmpty(t, createdID)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), createdID)
	require.NoError(t, err)

	assert.Equal(t, "fresh-topo", stored.Name, "the name must be derived from the definition")
	assert.Equal(t, "https://example.com/topo.yml", stored.SyncUrl)
	assert.Equal(t, h.Seed.Hidden.UUID, stored.Collection.UUID)

	// The definition must have been written to storage, not just recorded in the database.
	var onDisk string
	require.NoError(t, h.Storage.ReadTopology(createdID, &onDisk))
	assert.Equal(t, freshTopologyDefinition, onDisk)
}

func TestCreateTopology_MemberCanCreateInAPublicWriteCollection(t *testing.T) {
	h := NewHarness(t)

	var createdID string
	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicRW.UUID),
	}, h.Seed.Member.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)
}

func TestCreateTopology_MemberCannotCreateInANonPublicWriteCollection(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicDeploy.UUID),
	}, h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "write access to the provided collection is not granted")
}

func TestCreateTopology_MemberCannotCreateInACollectionItIsNotAMemberOf(t *testing.T) {
	h := NewHarness(t)

	// The hidden collection is publicWrite, but membership is also required.
	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.Hidden.UUID),
	}, h.Seed.Member.Token).RequireError(http.StatusForbidden, 403)
}

func TestCreateTopology_OutsiderIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicRW.UUID),
	}, h.Seed.Outsider.Token).RequireError(http.StatusForbidden, 403)
}

func TestCreateTopology_DuplicateNameInTheSameCollectionIsRejected(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(AdminTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicBoth.UUID),
	}, h.Seed.Admin.Token)

	response.RequireError(http.StatusBadRequest, 3001)
}

func TestCreateTopology_SameNameInADifferentCollectionIsAllowed(t *testing.T) {
	h := NewHarness(t)

	// Topology names are only unique within a collection.
	var createdID string
	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(AdminTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicRW.UUID),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)
}

func TestCreateTopology_InvalidYamlIsRejected(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr("\tnot: valid: yaml:\n\t\tbroken"),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicBoth.UUID),
	}, h.Seed.Admin.Token)

	errorResponse := response.RequireError(http.StatusBadRequest, 3003)
	assert.Contains(t, errorResponse.Message, "topology provided was invalid")
}

// TestCreateTopology_SchemaViolationIsRejected covers a definition that parses as YAML but does not
// satisfy the containerlab schema.
//
// schema.Service.Parse used to return the jsonschema validation error unwrapped, so
// utils.CreateErrorResponse had no case for it and fell through to a 500 — leaking the raw validator
// message and the upstream schema URL to the client. Wrapping it in utils.ErrInvalidTopology gives
// the documented 400 / code 3003 and keeps the detail in the server log.
func TestCreateTopology_SchemaViolationIsRejected(t *testing.T) {
	h := NewHarness(t)

	cases := map[string]string{
		"nodes is a sequence": "name: bad\ntopology:\n  nodes:\n    - not-a-map\n",
		"no topology section": "name: bad\n",
		"unknown top level":   "name: bad\ntopology:\n  nodes:\n    a:\n      kind: linux\nbogus: true\n",
	}

	for name, definition := range cases {
		t.Run(name, func(t *testing.T) {
			response := h.POST("/topologies", topology.TopologyIn{
				Definition:   ptr(definition),
				SyncUrl:      ptr(""),
				CollectionId: ptr(h.Seed.PublicBoth.UUID),
			}, h.Seed.Admin.Token)

			errorResponse := response.RequireError(http.StatusBadRequest, 3003)

			assert.Contains(t, errorResponse.Message, "topology provided was invalid")
			assert.NotContains(t, errorResponse.Message, "jsonschema",
				"the raw validator error must not reach the client")
			assert.NotContains(t, errorResponse.Message, "containerlab.dev",
				"the upstream schema URL must not reach the client")
		})
	}
}

func TestCreateTopology_UnknownCollectionIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr("no-such-collection"),
	}, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestCreateTopology_MissingRequiredFieldsAreRejected(t *testing.T) {
	h := NewHarness(t)

	bodies := map[string]map[string]any{
		"no definition":   {"syncUrl": "", "collectionId": h.Seed.PublicBoth.UUID},
		"no syncUrl":      {"definition": freshTopologyDefinition, "collectionId": h.Seed.PublicBoth.UUID},
		"no collectionId": {"definition": freshTopologyDefinition, "syncUrl": ""},
		"empty object":    {},
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			h.POST("/topologies", body, h.Seed.Admin.Token).RequireValidationError()
		})
	}
}

func TestCreateTopology_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	body := topology.TopologyIn{
		Definition:   ptr(freshTopologyDefinition),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicBoth.UUID),
	}

	h.POST("/topologies", body, "").RequireError(http.StatusUnauthorized, 401)
	h.POST("/topologies", body, "garbage").RequireError(498, 498)
}

/*
 * PATCH /topologies/:topologyId
 */

func TestUpdateTopology_OwnerCanReplaceTheDefinition(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{
		Definition: ptr(freshTopologyDefinition),
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)
	assert.Equal(t, "fresh-topo", stored.Name, "the name must be re-derived from the new definition")

	var onDisk string
	require.NoError(t, h.Storage.ReadTopology(TopologyAdminID, &onDisk))
	assert.Equal(t, freshTopologyDefinition, onDisk, "storage must be rewritten")
}

func TestUpdateTopology_CanUpdateOnlyTheSyncUrl(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{
		SyncUrl: ptr("https://example.com/new.yml"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)

	assert.Equal(t, "https://example.com/new.yml", stored.SyncUrl)
	assert.Equal(t, "admin-topo", stored.Name, "the definition must be untouched")

	var onDisk string
	require.NoError(t, h.Storage.ReadTopology(TopologyAdminID, &onDisk))
	assert.Equal(t, AdminTopologyDefinition, onDisk)
}

func TestUpdateTopology_CanMoveToAnotherWritableCollection(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyMemberID, topology.TopologyInPartial{
		CollectionId: ptr(h.Seed.PublicRW.UUID),
	}, h.Seed.Member.Token).RequireOk(nil)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyMemberID)
	require.NoError(t, err)
	assert.Equal(t, h.Seed.PublicRW.UUID, stored.Collection.UUID)
}

func TestUpdateTopology_CannotMoveToANonWritableCollection(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyMemberID, topology.TopologyInPartial{
		CollectionId: ptr(h.Seed.PublicDeploy.UUID),
	}, h.Seed.Member.Token).RequireError(http.StatusForbidden, 403)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyMemberID)
	require.NoError(t, err)
	assert.Equal(t, h.Seed.PublicBoth.UUID, stored.Collection.UUID, "the move must not have happened")
}

func TestUpdateTopology_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	response := h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{
		SyncUrl: ptr("https://hijacked.example"),
	}, h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "write access to the provided topology is not granted")
}

func TestUpdateTopology_AdminCanUpdateSomeoneElsesTopology(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyMemberID, topology.TopologyInPartial{
		SyncUrl: ptr("https://example.com/admin-edit.yml"),
	}, h.Seed.AdminBare.Token).RequireOk(nil)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyMemberID)
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/admin-edit.yml", stored.SyncUrl)
}

func TestUpdateTopology_RenamingOntoAnExistingNameIsRejected(t *testing.T) {
	h := NewHarness(t)

	// Rename the member topology to the admin topology's name; both live in PublicBoth.
	h.PATCH("/topologies/"+TopologyMemberID, topology.TopologyInPartial{
		Definition: ptr(AdminTopologyDefinition),
	}, h.Seed.Member.Token).RequireError(http.StatusBadRequest, 3001)
}

func TestUpdateTopology_ResubmittingTheSameDefinitionIsAllowed(t *testing.T) {
	h := NewHarness(t)

	// The duplicate check must skip the topology being edited.
	h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{
		Definition: ptr(AdminTopologyDefinition),
	}, h.Seed.Admin.Token).RequireOk(nil)
}

func TestUpdateTopology_InvalidDefinitionIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{
		Definition: ptr("\tbroken: yaml: here\n\t\tmore"),
	}, h.Seed.Admin.Token).RequireError(http.StatusBadRequest, 3003)

	// The stored definition must survive a rejected update.
	var onDisk string
	require.NoError(t, h.Storage.ReadTopology(TopologyAdminID, &onDisk))
	assert.Equal(t, AdminTopologyDefinition, onDisk)
}

func TestUpdateTopology_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/does-not-exist", topology.TopologyInPartial{
		SyncUrl: ptr(""),
	}, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestUpdateTopology_EmptyPatchIsANoOp(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{}, h.Seed.Admin.Token).
		RequireOk(nil)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)
	assert.Equal(t, "admin-topo", stored.Name)
}

func TestUpdateTopology_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPatch, "/topologies/"+TopologyAdminID, `{"syncUrl":`, h.Seed.Admin.Token).
		RequireValidationError()
}

/*
 * DELETE /topologies/:topologyId
 */

func TestDeleteTopology_OwnerCanDelete(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/"+TopologyMemberID, h.Seed.Member.Token).RequireOk(nil)

	_, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyMemberID)
	require.Error(t, err)
}

func TestDeleteTopology_AdminCanDeleteSomeoneElsesTopology(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/"+TopologyMemberID, h.Seed.AdminBare.Token).RequireOk(nil)

	_, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyMemberID)
	require.Error(t, err)
}

func TestDeleteTopology_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/"+TopologyAdminID, h.Seed.Member.Token).
		RequireError(http.StatusForbidden, 403)

	_, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err, "the topology must survive a forbidden delete")
}

func TestDeleteTopology_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/does-not-exist", h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestDeleteTopology_DeletingTwiceIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/"+TopologyMemberID, h.Seed.Member.Token).RequireOk(nil)
	h.DELETE("/topologies/"+TopologyMemberID, h.Seed.Member.Token).RequireError(http.StatusNotFound, -1)
}

// TestDeleteTopology_LeavesTheDefinitionOnDisk documents that deleting a topology is a database-only
// operation: the stored definition and any bind files stay behind in the storage directory.
//
// Whether that is intentional (recoverability) or a leak is a product decision, but it is worth
// knowing that deleting a topology does not reclaim its disk space.
func TestDeleteTopology_LeavesTheDefinitionOnDisk(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(nil)

	var onDisk string
	require.NoError(t, h.Storage.ReadTopology(TopologyAdminID, &onDisk),
		"the definition file is left behind after the row is deleted")
	assert.Equal(t, AdminTopologyDefinition, onDisk)
}

func TestDeleteTopology_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/topologies/"+TopologyAdminID, "").RequireError(http.StatusUnauthorized, 401)
	h.DELETE("/topologies/"+TopologyAdminID, "garbage").RequireError(498, 498)
}

/*
 * Helpers.
 */

func topologyIDs(topologies []transport.TopologyOut) []string {
	ids := make([]string, 0, len(topologies))
	for _, item := range topologies {
		ids = append(ids, item.ID)
	}

	return ids
}

func findTopology(t *testing.T, topologies []transport.TopologyOut, id string) transport.TopologyOut {
	t.Helper()

	for _, item := range topologies {
		if item.ID == id {
			return item
		}
	}

	t.Fatalf("topology %q not found in %v", id, topologyIDs(topologies))

	return transport.TopologyOut{}
}

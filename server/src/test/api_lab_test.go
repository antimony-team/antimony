package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/lab"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/transport"
	"antimonyBackend/utils"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// allLabs makes the listing limit explicit. It is no longer required — an unparameterised request
// returns everything — but the tests that assert on the full set keep it so they are unaffected if
// a default page size is introduced later.
const allLabs = "?limit=100"

/*
 * GET /labs
 */

// TestGetLabs_WithoutALimitReturnsEverything covers the default of the list contract.
//
// LabFilter.Limit is a plain int, so an unparameterised request arrives as 0. GORM turns Limit(0)
// into a literal "LIMIT 0", so the clause must only be applied when the limit is positive,
// otherwise the default listing (and every filter used without a limit) comes back empty.
func TestGetLabs_WithoutALimitReturnsEverything(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs", h.Seed.Admin.Token).RequireOk(&labs)

	assert.ElementsMatch(t, []string{
		LabAdminID, LabMemberID, LabHiddenID, LabPastID, LabFutureID,
	}, labIDs(labs))
}

func TestGetLabs_FiltersWorkWithoutAnExplicitLimit(t *testing.T) {
	h := NewHarness(t)

	// Every filter must be usable on its own, without the caller also having to pass a limit.
	var bySearch []labDTO
	h.GET("/labs?searchQuery=Member", h.Seed.Admin.Token).RequireOk(&bySearch)
	assert.Equal(t, []string{"Member Lab"}, labNames(bySearch))

	var byCollection []labDTO
	h.GET("/labs?collectionFilter[]="+h.Seed.Hidden.UUID, h.Seed.Admin.Token).RequireOk(&byCollection)
	assert.Equal(t, []string{LabHiddenID}, labIDs(byCollection))
}

func TestGetLabs_ZeroLimitIsTreatedAsNoLimit(t *testing.T) {
	h := NewHarness(t)

	// An explicit limit=0 is indistinguishable from an absent one, so it must mean "no limit"
	// rather than "no rows".
	var labs []labDTO
	h.GET("/labs?limit=0", h.Seed.Admin.Token).RequireOk(&labs)

	assert.Len(t, labs, 5)
}

func TestGetLabs_AdminSeesEveryLab(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs"+allLabs, h.Seed.Admin.Token).RequireOk(&labs)

	assert.ElementsMatch(t, []string{
		LabAdminID, LabMemberID, LabHiddenID, LabPastID, LabFutureID,
	}, labIDs(labs))
}

func TestGetLabs_MemberOnlySeesLabsInItsCollections(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs"+allLabs, h.Seed.Member.Token).RequireOk(&labs)

	ids := labIDs(labs)

	assert.ElementsMatch(t, []string{LabAdminID, LabMemberID, LabPastID, LabFutureID}, ids)
	assert.NotContains(t, ids, LabHiddenID)
}

func TestGetLabs_OutsiderSeesAnEmptyList(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs"+allLabs, h.Seed.Outsider.Token).RequireOk(&labs)

	assert.Empty(t, labs)
}

func TestGetLabs_OrdersByStartTime(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs"+allLabs, h.Seed.Admin.Token).RequireOk(&labs)

	require.Len(t, labs, 5)

	for i := 1; i < len(labs); i++ {
		assert.Falsef(
			t, labs[i].StartTime.Before(labs[i-1].StartTime),
			"labs must be ordered by start time, but %q came after %q", labs[i].Name, labs[i-1].Name,
		)
	}
}

func TestGetLabs_CarriesTheFullLabShape(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs"+allLabs, h.Seed.Admin.Token).RequireOk(&labs)

	found := findLab(t, labs, LabAdminID)

	assert.Equal(t, "Admin Lab", found.Name)
	assert.Equal(t, TopologyAdminID, found.TopologyId)
	assert.Equal(t, h.Seed.PublicBoth.UUID, found.CollectionId)
	assert.Equal(t, h.Seed.Admin.ID(), found.Creator.ID)
	assert.Equal(t, AdminTopologyDefinition, found.TopologyDefinition)
	assert.NotNil(t, found.EndTime)
	assert.Nil(t, found.Instance, "a lab that is not running must report a null instance")
}

func TestGetLabs_IncludesTheInstanceOfARunningLab(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	var labs []labDTO
	h.GET("/labs"+allLabs, h.Seed.Admin.Token).RequireOk(&labs)

	found := findLab(t, labs, LabAdminID)

	require.NotNil(t, found.Instance)
	assert.Equal(t, InstanceAdminLab, found.Instance.Name)
	assert.Equal(t, int(instance.InstanceStates.Running), found.Instance.State)
	assert.False(t, found.Instance.IsRecovered)
	assert.Len(t, found.Instance.Nodes, 2, "the seeded topology declares two nodes")

	// The other labs must still report no instance.
	assert.Nil(t, findLab(t, labs, LabMemberID).Instance)
}

func TestGetLabs_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.GET("/labs", "").RequireError(http.StatusUnauthorized, 401)
	h.GET("/labs", "garbage").RequireError(498, 498)
}

/*
 * GET /labs/:labId
 */

func TestGetLabByUuid_ReturnsTheLab(t *testing.T) {
	h := NewHarness(t)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	assert.Equal(t, LabAdminID, labOut.ID)
	assert.Equal(t, "Admin Lab", labOut.Name)
	assert.Nil(t, labOut.Instance)
}

func TestGetLabByUuid_MemberCanReadOneInItsCollections(t *testing.T) {
	h := NewHarness(t)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Member.Token).RequireOk(&labOut)

	assert.Equal(t, LabAdminID, labOut.ID)
}

// TestGetLabByUuid_InaccessibleLabIsForbidden covers the access check on a single lab.
//
// Both labs and topologies answer 403 here rather than masking as 404: the IDs are server-generated
// UUIDs so a 404 bought little obfuscation, and a real error is more useful to the client.
func TestGetLabByUuid_InaccessibleLabIsForbidden(t *testing.T) {
	h := NewHarness(t)

	errorResponse := h.GET("/labs/"+LabHiddenID, h.Seed.Member.Token).
		RequireError(http.StatusForbidden, 403)

	assert.Contains(t, errorResponse.Message, "access to the provided lab is not granted")
}

func TestGetLabByUuid_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.GET("/labs/does-not-exist", h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestGetLabByUuid_ReportsTheRunningInstance(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	var labOut labDTO
	h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(&labOut)

	require.NotNil(t, labOut.Instance)
	assert.Equal(t, int(instance.InstanceStates.Running), labOut.Instance.State)

	assert.ElementsMatch(t, []string{NodeSRL, NodeHost}, nodeNames(labOut.Instance.Nodes))
}

/*
 * POST /labs
 */

func TestCreateLab_OwnerCanCreateOnADeployableCollection(t *testing.T) {
	h := NewHarness(t)

	events := h.RecordLabEvents("lab.created")

	start := time.Now().Add(time.Hour).Truncate(time.Second)
	end := start.Add(2 * time.Hour)

	var createdID string
	h.POST("/labs", lab.LabIn{
		Name:       ptr("Fresh Lab"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyAdminID),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	require.NotEmpty(t, createdID)

	stored, err := h.LabRepo.GetByUuid(t.Context(), createdID)
	require.NoError(t, err)

	assert.Equal(t, "Fresh Lab", stored.Name)
	assert.Equal(t, TopologyAdminID, stored.Topology.UUID)
	assert.Equal(t, h.Seed.Admin.ID(), stored.Creator.UUID)
	assert.NotEmpty(t, stored.InstanceName, "an instance name must be generated")
	require.NotNil(t, stored.TopologyDefinition)
	assert.Equal(t, AdminTopologyDefinition, *stored.TopologyDefinition,
		"the definition must be snapshotted at creation time")

	// The run environment must exist on disk so the lab can actually be deployed later.
	var runDefinition string
	require.NoError(t, h.Storage.ReadRunTopologyDefinition(createdID, &runDefinition))
	assert.Contains(t, runDefinition, "name: "+stored.InstanceName,
		"the run definition is renamed to the instance name")

	assert.Equal(t, []string{createdID}, events.LabIdsFor("lab.created"))
}

func TestCreateLab_MemberCanCreateOnAPublicDeployCollection(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	var createdID string
	h.POST("/labs", lab.LabIn{
		Name:       ptr("Member Fresh Lab"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyAdminID),
	}, h.Seed.Member.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)
}

func TestCreateLab_MemberCannotCreateOnANonDeployableCollection(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	response := h.POST("/labs", lab.LabIn{
		Name:       ptr("Nope"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyPrivateID),
	}, h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "deploy access to the provided collection is not granted")
}

func TestCreateLab_MemberCannotCreateOnACollectionItIsNotAMemberOf(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	h.POST("/labs", lab.LabIn{
		Name:       ptr("Nope"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyHiddenID),
	}, h.Seed.Member.Token).RequireError(http.StatusForbidden, 403)
}

func TestCreateLab_AdminCanCreateAnywhere(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	var createdID string
	h.POST("/labs", lab.LabIn{
		Name:       ptr("Admin Anywhere"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyHiddenID),
	}, h.Seed.AdminBare.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)
}

func TestCreateLab_UnknownTopologyIsNotFound(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	h.POST("/labs", lab.LabIn{
		Name:       ptr("Nope"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr("no-such-topology"),
	}, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestCreateLab_MissingRequiredFieldsAreRejected(t *testing.T) {
	h := NewHarness(t)

	now := time.Now().Format(time.RFC3339)

	// endTime is deliberately absent from this list: a lab created without one is indefinite.
	// See TestCreateLab_AcceptsNoEndTime.
	bodies := map[string]map[string]any{
		"no name":       {"startTime": now, "endTime": now, "topologyId": TopologyAdminID},
		"no startTime":  {"name": "x", "endTime": now, "topologyId": TopologyAdminID},
		"no topologyId": {"name": "x", "startTime": now, "endTime": now},
		"empty object":  {},
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			h.POST("/labs", body, h.Seed.Admin.Token).RequireValidationError()
		})
	}
}

func TestCreateLab_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPost, "/labs", `{"name":`, h.Seed.Admin.Token).RequireValidationError()
}

func TestCreateLab_InstanceNameIsDerivedFromTheTopologyAndATimestamp(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	var createdID string
	h.POST("/labs", lab.LabIn{
		Name:       ptr("Named Lab"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyAdminID),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	stored, err := h.LabRepo.GetByUuid(t.Context(), createdID)
	require.NoError(t, err)

	assert.Regexp(t, `^admin-topo-[0-9a-f]{8,}$`, stored.InstanceName,
		"the instance name is the sanitised topology name plus a unique suffix")
}

// TestCreateLab_RapidCreationNeverCollides covers instance name generation under load.
//
// The instance name used to be the topology name plus a millisecond timestamp, and InstanceName
// carries a unique index, so two labs created on the same topology within the same millisecond
// collided and the user got an opaque database error. The generated name has to be unique
// regardless of timing.
func TestCreateLab_RapidCreationNeverCollides(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	names := make(map[string]struct{})

	for i := range 25 {
		var createdID string
		h.POST("/labs", lab.LabIn{
			Name:       ptr("Repeat"),
			StartTime:  &start,
			EndTime:    &end,
			TopologyId: ptr(TopologyAdminID),
		}, h.Seed.Admin.Token).RequireOk(&createdID)

		stored, err := h.LabRepo.GetByUuid(t.Context(), createdID)
		require.NoError(t, err)

		_, duplicate := names[stored.InstanceName]
		require.Falsef(t, duplicate, "instance name %q was reused on iteration %d", stored.InstanceName, i)

		names[stored.InstanceName] = struct{}{}
	}

	assert.Len(t, names, 25)
}

// TestInstanceOut_NodeStateRoundTrips covers the JSON representation of deployment.NodeState.
//
// NodeState used to carry an UnmarshalText (so containerlab's inspect output, which reports states
// as strings like "running", could be decoded) with no matching marshaller. encoding/json therefore
// wrote it as a number and then refused to read that number back, so a Go client could not decode
// this API's own response using the transport types. The string parsing belongs to the containerlab
// provider's own DTO, not to the shared type.
func TestInstanceOut_NodeStateRoundTrips(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	response := h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireStatus(http.StatusOK)

	var envelope utils.OkResponse[json.RawMessage]
	require.NoError(t, json.Unmarshal([]byte(response.Body()), &envelope))

	// The API's own output must decode into the transport types it was produced from.
	var decoded transport.LabOut
	require.NoError(t, json.Unmarshal(envelope.Payload, &decoded),
		"transport.LabOut must be able to decode the response it produced")

	require.NotNil(t, decoded.Instance)

	var host *instance.InstanceNode
	for _, node := range decoded.Instance.Nodes {
		if node.Name == NodeHost {
			host = node
			break
		}
	}

	require.NotNil(t, host)
	assert.Equal(t, deployment.NodeStates.Running, host.State)
}

func TestCreateLab_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	body := lab.LabIn{
		Name:       ptr("x"),
		StartTime:  &start,
		EndTime:    &end,
		TopologyId: ptr(TopologyAdminID),
	}

	h.POST("/labs", body, "").RequireError(http.StatusUnauthorized, 401)
	h.POST("/labs", body, "garbage").RequireError(498, 498)
}

/*
 * PATCH /labs/:labId
 */

func TestUpdateLab_OwnerCanRename(t *testing.T) {
	h := NewHarness(t)

	events := h.RecordLabEvents("lab.moved")

	h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{Name: ptr("Renamed Lab")}, h.Seed.Admin.Token).
		RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	assert.Equal(t, "Renamed Lab", stored.Name)

	assert.Zero(t, events.Count("lab.moved"), "a rename must not reschedule the lab")
}

func TestUpdateLab_MovingTheScheduleRepublishesIt(t *testing.T) {
	h := NewHarness(t)

	events := h.RecordLabEvents("lab.moved")

	newStart := time.Now().Add(5 * time.Hour).Truncate(time.Second)
	newEnd := newStart.Add(time.Hour)

	h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{
		StartTime: &newStart,
		EndTime:   &newEnd,
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)

	assert.WithinDuration(t, newStart, stored.StartTime, time.Second)
	require.NotNil(t, stored.EndTime)
	assert.WithinDuration(t, newEnd, *stored.EndTime, time.Second)

	assert.Equal(t, []string{LabAdminID}, events.LabIdsFor("lab.moved"))
}

func TestUpdateLab_IndefiniteClearsTheEndTime(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{Indefinite: ptr(true)}, h.Seed.Admin.Token).
		RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	assert.Nil(t, stored.EndTime, "an indefinite lab has no end time")
}

func TestUpdateLab_IndefiniteTakesPrecedenceOverAnEndTime(t *testing.T) {
	h := NewHarness(t)

	end := time.Now().Add(10 * time.Hour)

	h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{
		Indefinite: ptr(true),
		EndTime:    &end,
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	assert.Nil(t, stored.EndTime, "indefinite wins when both are supplied")
}

func TestUpdateLab_IndefiniteFalseLeavesTheEndTimeAlone(t *testing.T) {
	h := NewHarness(t)

	before, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	require.NotNil(t, before.EndTime)

	h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{Indefinite: ptr(false)}, h.Seed.Admin.Token).
		RequireOk(nil)

	after, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	require.NotNil(t, after.EndTime)
	assert.WithinDuration(t, *before.EndTime, *after.EndTime, time.Second)
}

func TestUpdateLab_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	response := h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{Name: ptr("Hijacked")},
		h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "write access to the provided lab is not granted")
}

func TestUpdateLab_AdminCanUpdateSomeoneElsesLab(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/labs/"+LabMemberID, lab.LabInPartial{Name: ptr("Admin Renamed")},
		h.Seed.AdminBare.Token).RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabMemberID)
	require.NoError(t, err)
	assert.Equal(t, "Admin Renamed", stored.Name)
}

// TestUpdateLab_RunningLabIsRejected covers refusing to edit a running lab.
//
// This is a client mistake, not a server failure, so utils.ErrLabRunning needs an HTTP mapping —
// without one it surfaced as a bare 500. It gets its own code so a client can tell it apart from
// the other 400s this endpoint returns for a malformed payload.
func TestUpdateLab_RunningLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	response := h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{Name: ptr("Nope")}, h.Seed.Admin.Token)

	errorResponse := response.RequireError(http.StatusBadRequest, 4003)
	assert.Contains(t, errorResponse.Message, "modifications to a running lab are not allowed")

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	assert.Equal(t, "Admin Lab", stored.Name, "the lab must be unchanged")
}

func TestUpdateLab_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/labs/does-not-exist", lab.LabInPartial{Name: ptr("x")}, h.Seed.Admin.Token).
		RequireError(http.StatusNotFound, -1)
}

func TestUpdateLab_EmptyPatchIsANoOp(t *testing.T) {
	h := NewHarness(t)

	events := h.RecordLabEvents("lab.moved")

	h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)

	assert.Equal(t, "Admin Lab", stored.Name)
	assert.Zero(t, events.Count("lab.moved"))
}

func TestUpdateLab_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPatch, "/labs/"+LabAdminID, `{"name":`, h.Seed.Admin.Token).
		RequireValidationError()
}

func TestUpdateLab_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	body := lab.LabInPartial{Name: ptr("x")}

	h.PATCH("/labs/"+LabAdminID, body, "").RequireError(http.StatusUnauthorized, 401)
	h.PATCH("/labs/"+LabAdminID, body, "garbage").RequireError(498, 498)
}

/*
 * DELETE /labs/:labId
 */

func TestDeleteLab_OwnerCanDelete(t *testing.T) {
	h := NewHarness(t)

	events := h.RecordLabEvents("lab.deleted")

	h.DELETE("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(nil)

	_, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.Error(t, err, "the lab row must be gone")

	// Unlike topologies, deleting a lab does reclaim its run environment.
	var runDefinition string
	require.Error(t, h.Storage.ReadRunTopologyDefinition(LabAdminID, &runDefinition),
		"the run environment must be removed from disk")

	assert.Equal(t, []string{LabAdminID}, events.LabIdsFor("lab.deleted"))
}

func TestDeleteLab_AdminCanDeleteSomeoneElsesLab(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/labs/"+LabMemberID, h.Seed.AdminBare.Token).RequireOk(nil)

	_, err := h.LabRepo.GetByUuid(t.Context(), LabMemberID)
	require.Error(t, err)
}

func TestDeleteLab_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/labs/"+LabAdminID, h.Seed.Member.Token).RequireError(http.StatusForbidden, 403)

	_, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err, "the lab must survive a forbidden delete")
}

func TestDeleteLab_RunningLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	response := h.DELETE("/labs/"+LabAdminID, h.Seed.Admin.Token)

	errorResponse := response.RequireError(http.StatusBadRequest, 4003)
	assert.Contains(t, errorResponse.Message, "modifications to a running lab are not allowed")

	_, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
}

func TestDeleteLab_FailedLabCanBeDeleted(t *testing.T) {
	h := NewHarness(t)

	// A deployment that fails leaves the instance in the Failed state, which CanDelete allows
	// precisely so a broken lab is not stuck forever.
	h.Provider.DeployFn = func(string, string, deployment.LogFunc) error { return errFakeProvider }

	instanceLab, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	require.Error(t, h.InstanceService.DeployLab(instanceLab))

	require.True(t, h.InstanceService.IsRunning(LabAdminID), "the failed instance is still tracked")
	require.True(t, h.InstanceService.CanDelete(LabAdminID), "a failed lab must be deletable")

	h.DELETE("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(nil)

	_, err = h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.Error(t, err)
}

func TestDeleteLab_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/labs/does-not-exist", h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestDeleteLab_DeletingTwiceIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireOk(nil)
	h.DELETE("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestDeleteLab_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/labs/"+LabAdminID, "").RequireError(http.StatusUnauthorized, 401)
	h.DELETE("/labs/"+LabAdminID, "garbage").RequireError(498, 498)
}

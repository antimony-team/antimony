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

// allLabs is the query string needed to actually list labs. See
// TestGetLabs_WithoutAnExplicitLimitReturnsNothing for why an explicit limit is mandatory.
const allLabs = "?limit=100"

/*
 * GET /labs
 */

// TestGetLabs_WithoutAnExplicitLimitReturnsNothing pins a bug in the list contract.
//
// LabFilter.Limit is a plain int, so a request without a `limit` query parameter arrives as 0, and
// lab.Repository.GetAll applies it unconditionally:
//
//	query = query.Limit(labFilter.Limit).Offset(labFilter.Offset)
//
// GORM turns Limit(0) into a literal `LIMIT 0`, so the unparameterised list endpoint returns an
// empty array rather than every lab. Every other filter is affected too: a request that only sets
// searchQuery or stateFilter also returns nothing, because it does not set a limit either.
//
// The fix is to only apply the clause when the limit is positive (GORM treats -1 as "no limit").
func TestGetLabs_WithoutAnExplicitLimitReturnsNothing(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs", h.Seed.Admin.Token).RequireOk(&labs)

	assert.Empty(t, labs, "LIMIT 0 swallows every row")

	// The same request with a limit returns the labs that were there all along.
	var withLimit []labDTO
	h.GET("/labs"+allLabs, h.Seed.Admin.Token).RequireOk(&withLimit)

	assert.Len(t, withLimit, 5)
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

// TestGetLabByUuid_InaccessibleLabIsForbidden records an inconsistency worth knowing about rather
// than a bug: an inaccessible *topology* is masked as 404 so its existence cannot be probed, but an
// inaccessible *lab* answers 403, which confirms it exists.
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

	bodies := map[string]map[string]any{
		"no name":       {"startTime": now, "endTime": now, "topologyId": TopologyAdminID},
		"no startTime":  {"name": "x", "endTime": now, "topologyId": TopologyAdminID},
		"no endTime":    {"name": "x", "startTime": now, "topologyId": TopologyAdminID},
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

	assert.Regexp(t, `^admin-topo-\d{13}$`, stored.InstanceName,
		"the instance name is the sanitised topology name plus a millisecond timestamp")
}

// TestCreateLab_RapidCreationCollidesOnTheInstanceName pins a race that surfaces as an opaque 500.
//
// lab.Service.createLabEnvironment builds the instance name as:
//
//	fmt.Sprintf("%s-%d", runTopologyName, time.Now().UnixMilli())
//
// and Lab.InstanceName carries a uniqueIndex. Two labs created on the same topology within the same
// millisecond therefore collide, and the user gets "the antimony database encountered an error".
//
// This is timing dependent, so the test creates labs in a tight loop and only asserts that *if* a
// failure happens it is this collision. It does not assert that a collision must occur.
//
// A UUID suffix (or a retry on unique-constraint violation) would remove the race entirely.
func TestCreateLab_RapidCreationCollidesOnTheInstanceName(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)

	names := make(map[string]struct{})
	collisions := 0

	for range 20 {
		response := h.POST("/labs", lab.LabIn{
			Name:       ptr("Repeat"),
			StartTime:  &start,
			EndTime:    &end,
			TopologyId: ptr(TopologyAdminID),
		}, h.Seed.Admin.Token)

		if response.Status() == http.StatusInternalServerError {
			collisions++

			errorResponse := response.RequireError(http.StatusInternalServerError, 500)
			assert.Contains(t, errorResponse.Message, "database",
				"the only expected failure here is the instance name collision")

			continue
		}

		var createdID string
		response.RequireOk(&createdID)

		stored, err := h.LabRepo.GetByUuid(t.Context(), createdID)
		require.NoError(t, err)

		_, duplicate := names[stored.InstanceName]
		require.False(t, duplicate, "two labs must never share an instance name")

		names[stored.InstanceName] = struct{}{}
	}

	if collisions > 0 {
		t.Logf(
			"%d of 20 rapid lab creations failed on the instance name unique index (millisecond "+
				"timestamp granularity)", collisions,
		)
	}
}

// TestInstanceOut_NodeStateDoesNotRoundTrip pins the JSON asymmetry on deployment.NodeState.
//
// NodeState has an UnmarshalText (added so containerlab's inspect output, which reports states as
// strings like "running", can be decoded) but no MarshalText or MarshalJSON. So encoding/json
// writes the state as a number and then refuses to read that number back, which means a Go client
// cannot decode this API's own response using the transport types. The TypeScript frontend is
// unaffected because it only ever sees the number.
//
// Adding a MarshalText that emits the same lowercase names UnmarshalText accepts would make the
// representation symmetric, at the cost of changing the wire format. Dropping UnmarshalText from
// the shared type and doing the string parsing in the containerlab provider's own DTO would keep
// the wire format as it is.
func TestInstanceOut_NodeStateDoesNotRoundTrip(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// Decoding into the transport type fails on the node state.
	var viaTransportTypes transport.LabOut
	response := h.GET("/labs/"+LabAdminID, h.Seed.Admin.Token).RequireStatus(http.StatusOK)

	var envelope utils.OkResponse[json.RawMessage]
	require.NoError(t, json.Unmarshal([]byte(response.Body()), &envelope))

	err := json.Unmarshal(envelope.Payload, &viaTransportTypes)
	require.Error(t, err, "the API's own output must currently fail to decode into transport.LabOut")
	assert.Contains(t, err.Error(), "JSON value must be string type")

	// The state is on the wire as a number, which is what the test DTOs decode.
	var viaTestTypes labDTO
	require.NoError(t, json.Unmarshal(envelope.Payload, &viaTestTypes))
	require.NotNil(t, viaTestTypes.Instance)

	host := findNode(t, viaTestTypes.Instance.Nodes, NodeHost)
	assert.Equal(t, int(deployment.NodeStates.Running), host.State)
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

// TestUpdateLab_RunningLabIsRejectedAsA500 pins the status of a client error that has no HTTP
// mapping. utils.ErrLabRunning is not handled by utils.CreateErrorResponse, so refusing to edit a
// running lab surfaces as a bare 500 with code -1. A 409 Conflict would be the honest answer.
func TestUpdateLab_RunningLabIsRejectedAsA500(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	response := h.PATCH("/labs/"+LabAdminID, lab.LabInPartial{Name: ptr("Nope")}, h.Seed.Admin.Token)

	errorResponse := response.RequireError(http.StatusInternalServerError, -1)
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

	errorResponse := response.RequireError(http.StatusInternalServerError, -1)
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

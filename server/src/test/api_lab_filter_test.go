package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/runtime/instance"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// listLabs issues a lab query with an explicit limit already applied, since a request without one
// returns nothing (see TestGetLabs_WithoutAnExplicitLimitReturnsNothing).
func listLabs(t *testing.T, h *Harness, token string, query string) []labDTO {
	t.Helper()

	path := "/labs" + allLabs
	if query != "" {
		path += "&" + query
	}

	var labs []labDTO
	h.GET(path, token).RequireOk(&labs)

	return labs
}

/*
 * limit / offset
 */

func TestLabFilter_LimitCapsTheResultCount(t *testing.T) {
	h := NewHarness(t)

	for limit, expected := range map[int]int{1: 1, 3: 3, 5: 5, 50: 5} {
		t.Run("limit="+strconv.Itoa(limit), func(t *testing.T) {
			var labs []labDTO
			h.GET("/labs?limit="+strconv.Itoa(limit), h.Seed.Admin.Token).RequireOk(&labs)

			assert.Len(t, labs, expected)
		})
	}
}

func TestLabFilter_OffsetSkipsFromTheStart(t *testing.T) {
	h := NewHarness(t)

	all := listLabs(t, h, h.Seed.Admin.Token, "")
	require.Len(t, all, 5)

	var skipped []labDTO
	h.GET("/labs?limit=100&offset=2", h.Seed.Admin.Token).RequireOk(&skipped)

	require.Len(t, skipped, 3)
	assert.Equal(t, labIDs(all)[2:], labIDs(skipped))
}

func TestLabFilter_LimitAndOffsetPaginate(t *testing.T) {
	h := NewHarness(t)

	all := labIDs(listLabs(t, h, h.Seed.Admin.Token, ""))
	require.Len(t, all, 5)

	seen := make([]string, 0, 5)

	for offset := 0; offset < 5; offset += 2 {
		var page []labDTO
		h.GET("/labs?limit=2&offset="+strconv.Itoa(offset), h.Seed.Admin.Token).RequireOk(&page)

		seen = append(seen, labIDs(page)...)
	}

	assert.Equal(t, all, seen, "paging through must visit every lab exactly once, in order")
}

func TestLabFilter_OffsetBeyondTheEndIsEmpty(t *testing.T) {
	h := NewHarness(t)

	var labs []labDTO
	h.GET("/labs?limit=100&offset=500", h.Seed.Admin.Token).RequireOk(&labs)

	assert.Empty(t, labs)
}

/*
 * searchQuery
 */

func TestLabFilter_SearchMatchesTheLabName(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "searchQuery=Member")

	assert.Equal(t, []string{"Member Lab"}, labNames(labs))
}

func TestLabFilter_SearchMatchesTheTopologyName(t *testing.T) {
	h := NewHarness(t)

	// Three labs sit on the admin topology: Admin Lab, Past Lab and Future Lab.
	labs := listLabs(t, h, h.Seed.Admin.Token, "searchQuery=admin-topo")

	assert.ElementsMatch(t, []string{LabAdminID, LabPastID, LabFutureID}, labIDs(labs))
}

func TestLabFilter_SearchMatchesTheCollectionName(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "searchQuery="+CollectionPublicBoth)

	assert.ElementsMatch(t, []string{LabAdminID, LabMemberID, LabPastID, LabFutureID}, labIDs(labs))
}

func TestLabFilter_SearchIsASubstringMatch(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "searchQuery=ast+La")

	assert.Equal(t, []string{"Past Lab"}, labNames(labs))
}

func TestLabFilter_SearchWithNoMatchIsEmpty(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "searchQuery=nothing-matches-this")

	assert.Empty(t, labs)
}

func TestLabFilter_EmptySearchQueryIsIgnored(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "searchQuery=")

	assert.Len(t, labs, 5, "an empty search must not filter anything out")
}

func TestLabFilter_SearchRespectsCollectionScoping(t *testing.T) {
	h := NewHarness(t)

	// The hidden lab matches the query by name but must not be visible to a member.
	labs := listLabs(t, h, h.Seed.Member.Token, "searchQuery=Lab")

	assert.NotContains(t, labIDs(labs), LabHiddenID)
}

/*
 * collectionFilter
 */

func TestLabFilter_CollectionFilterNarrowsByCollectionUuid(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "collectionFilter[]="+h.Seed.Hidden.UUID)

	assert.Equal(t, []string{LabHiddenID}, labIDs(labs))
}

func TestLabFilter_CollectionFilterAcceptsSeveralCollections(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"collectionFilter[]="+h.Seed.Hidden.UUID+"&collectionFilter[]="+h.Seed.PublicBoth.UUID)

	assert.ElementsMatch(t,
		[]string{LabHiddenID, LabAdminID, LabMemberID, LabPastID, LabFutureID}, labIDs(labs))
}

func TestLabFilter_CollectionFilterWithAnUnknownUuidIsEmpty(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "collectionFilter[]=no-such-collection")

	assert.Empty(t, labs)
}

func TestLabFilter_CollectionFilterCannotBypassScoping(t *testing.T) {
	h := NewHarness(t)

	// Asking explicitly for the hidden collection must not reveal it to a non-member.
	labs := listLabs(t, h, h.Seed.Member.Token, "collectionFilter[]="+h.Seed.Hidden.UUID)

	assert.Empty(t, labs, "the service-level collection scoping must still apply")
}

/*
 * startDate / endDate
 */

func TestLabFilter_StartDateKeepsLabsStartingLater(t *testing.T) {
	h := NewHarness(t)

	// Only the future lab starts more than an hour from now.
	cutoff := time.Now().Add(2 * time.Hour).Format(time.RFC3339)
	labs := listLabs(t, h, h.Seed.Admin.Token, "startDate="+url.QueryEscape(cutoff))

	assert.Equal(t, []string{LabFutureID}, labIDs(labs))
}

func TestLabFilter_StartDateInTheFarFutureIsEmpty(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "startDate="+url.QueryEscape("2099-01-01T00:00:00Z"))

	assert.Empty(t, labs)
}

func TestLabFilter_EndDateKeepsLabsEndingEarlier(t *testing.T) {
	h := NewHarness(t)

	// Only the past lab has already ended.
	cutoff := time.Now().Format(time.RFC3339)
	labs := listLabs(t, h, h.Seed.Admin.Token, "endDate="+url.QueryEscape(cutoff))

	assert.Equal(t, []string{LabPastID}, labIDs(labs))
}

func TestLabFilter_EndDateInThePastIsEmpty(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "endDate="+url.QueryEscape("2000-01-01T00:00:00Z"))

	assert.Empty(t, labs)
}

func TestLabFilter_DateRangeAppliesBothBounds(t *testing.T) {
	h := NewHarness(t)

	start := time.Now().Add(-2 * time.Hour).Format(time.RFC3339)
	end := time.Now().Add(4 * time.Hour).Format(time.RFC3339)

	fromStart := labIDs(listLabs(t, h, h.Seed.Admin.Token, "startDate="+url.QueryEscape(start)))
	untilEnd := labIDs(listLabs(t, h, h.Seed.Admin.Token, "endDate="+url.QueryEscape(end)))
	both := labIDs(listLabs(t, h, h.Seed.Admin.Token,
		"startDate="+url.QueryEscape(start)+"&endDate="+url.QueryEscape(end)))

	require.NotEmpty(t, both, "the range must match at least one lab")

	// Combining the bounds must narrow the result, never widen it.
	for _, id := range both {
		assert.Containsf(t, fromStart, id, "%s must also satisfy the lower bound alone", id)
		assert.Containsf(t, untilEnd, id, "%s must also satisfy the upper bound alone", id)
	}

	assert.LessOrEqual(t, len(both), len(fromStart))
	assert.LessOrEqual(t, len(both), len(untilEnd))
}

func TestLabFilter_MalformedDateIsRejected(t *testing.T) {
	h := NewHarness(t)

	// ctx.BindQuery flushes a 400, and the handler then writes the error through
	// CreateErrorResponse (which has no case for a time parse failure), so the body carries -1
	// rather than the 422 the other endpoints use for a bad request body.
	errorResponse := h.GET("/labs?limit=100&startDate=not-a-date", h.Seed.Admin.Token).
		RequireError(http.StatusBadRequest, -1)

	assert.Contains(t, errorResponse.Message, "parsing time")
}

func TestLabFilter_MalformedLimitIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.GET("/labs?limit=not-a-number", h.Seed.Admin.Token).RequireStatus(http.StatusBadRequest)
}

// TestLabFilter_DateBoundsAreSensitiveToTheUtcOffset records that the same instant, expressed with
// two different UTC offsets, does not select the same labs.
//
// These two bounds describe the identical moment:
//
//	2026-09-30T12:56:51Z          -> matched nothing
//	2026-09-30T14:56:51+02:00     -> matched the already-ended lab
//
// so the comparison is being made on the wall-clock text rather than on the instant, and the
// effective cutoff shifts by the local offset. A client that sends UTC (as JSON normally does) gets
// a different window than one that sends a local offset.
//
// Caveat on scope: these tests run against SQLite, where glebarez/sqlite decides the on-disk time
// representation. PostgreSQL with a timestamptz column would very likely compare instants
// correctly, so this may be an artefact of the test database rather than a production defect. It is
// worth confirming against PostgreSQL before treating it as a bug — but it does mean the date
// filters are not portable across the two backends the project supports.
func TestLabFilter_DateBoundsAreSensitiveToTheUtcOffset(t *testing.T) {
	h := NewHarness(t)

	instant := time.Now()

	asLocal := labIDs(listLabs(t, h, h.Seed.Admin.Token,
		"endDate="+url.QueryEscape(instant.Format(time.RFC3339))))
	asUTC := labIDs(listLabs(t, h, h.Seed.Admin.Token,
		"endDate="+url.QueryEscape(instant.UTC().Format(time.RFC3339))))

	if instant.Format(time.RFC3339) == instant.UTC().Format(time.RFC3339) {
		t.Skip("the machine runs in UTC, so there is no offset to be sensitive to")
	}

	assert.NotEqual(t, asLocal, asUTC,
		"the same instant in two offsets currently yields different results")
}

/*
 * stateFilter
 */

func TestLabFilter_StateFilterMatchesInactiveLabs(t *testing.T) {
	h := NewHarness(t)

	// With nothing deployed every lab is inactive.
	labs := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Inactive)))

	assert.Len(t, labs, 5)
}

func TestLabFilter_StateFilterMatchesRunningLabs(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Running)))

	assert.Equal(t, []string{LabAdminID}, labIDs(labs))
}

func TestLabFilter_StateFilterExcludesRunningLabsWhenAskingForInactive(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Inactive)))

	ids := labIDs(labs)

	assert.NotContains(t, ids, LabAdminID, "the running lab is no longer inactive")
	assert.Len(t, ids, 4)
}

func TestLabFilter_StateFilterAcceptsSeveralStates(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Running))+
			"&stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Inactive)))

	assert.Len(t, labs, 5, "asking for running or inactive covers every lab")
}

func TestLabFilter_StateFilterMatchesFailedLabs(t *testing.T) {
	h := NewHarness(t)

	h.Provider.DeployFn = func(string, string, deployment.LogFunc) error { return deployment.ErrDummyProvider }

	instanceLab, err := h.LabRepo.GetByUuid(t.Context(), LabAdminID)
	require.NoError(t, err)
	require.Error(t, h.InstanceService.DeployLab(instanceLab))

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Failed)))

	assert.Equal(t, []string{LabAdminID}, labIDs(labs))
}

// TestLabFilter_ScheduledStateIsNeverReported documents a gap the handler itself flags with a TODO.
//
// InstanceStates.Scheduled exists and is meant to describe a lab whose start time is still in the
// future, but the lab handler cannot see the scheduler (the dependency is commented out), so such a
// lab is reported as Inactive and filtering for Scheduled never matches anything.
func TestLabFilter_ScheduledStateIsNeverReported(t *testing.T) {
	h := NewHarness(t)

	scheduled := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Scheduled)))

	assert.Empty(t, scheduled, "no lab is ever reported as scheduled")

	// The future lab shows up as inactive instead.
	inactive := listLabs(t, h, h.Seed.Admin.Token,
		"stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Inactive)))

	assert.Contains(t, labIDs(inactive), LabFutureID)
}

func TestLabFilter_UnknownStateIsEmpty(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token, "stateFilter[]=99")

	assert.Empty(t, labs)
}

/*
 * Combinations
 */

// TestLabFilter_CombinesSearchAndCollection covers using both narrowing filters at once.
//
// Both branches of lab.Repository.GetAll used to add the same pair of joins, so setting both
// emitted them twice and the query failed with "ambiguous column name: collections.uuid". The joins
// have to be added at most once.
func TestLabFilter_CombinesSearchAndCollection(t *testing.T) {
	h := NewHarness(t)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"searchQuery=Lab&collectionFilter[]="+h.Seed.Hidden.UUID)

	assert.Equal(t, []string{LabHiddenID}, labIDs(labs))
}

func TestLabFilter_CombinesSearchCollectionAndDates(t *testing.T) {
	h := NewHarness(t)

	// All three narrowing filters together must still produce a valid query.
	start := time.Now().Add(-4 * time.Hour).Format(time.RFC3339)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"searchQuery=Lab&collectionFilter[]="+h.Seed.PublicBoth.UUID+
			"&startDate="+url.QueryEscape(start))

	assert.NotEmpty(t, labs)
	for _, id := range labIDs(labs) {
		assert.NotEqual(t, LabHiddenID, id, "the collection filter must still apply")
	}
}

func TestLabFilter_CombinesStateAndSearch(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	labs := listLabs(t, h, h.Seed.Admin.Token,
		"searchQuery=Admin&stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Running)))

	assert.Equal(t, []string{LabAdminID}, labIDs(labs))
}

func TestLabFilter_StateFilterAppliesAfterPaging(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	// The state filter runs in the handler, over the page the repository already returned, so a
	// page that does not contain the running lab yields nothing even though one exists.
	var labs []labDTO
	h.GET("/labs?limit=1&stateFilter[]="+strconv.Itoa(int(instance.InstanceStates.Running)),
		h.Seed.Admin.Token).RequireOk(&labs)

	assert.Empty(t, labs, "state filtering is applied to the page, not to the whole table")
}

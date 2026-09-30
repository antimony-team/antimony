package test

import (
	"antimonyBackend/domain/collection"
	"antimonyBackend/transport"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * GET /collections
 */

func TestGetCollections_AdminSeesEverything(t *testing.T) {
	h := NewHarness(t)

	var collections []transport.CollectionOut
	h.GET("/collections", h.Seed.Admin.Token).RequireOk(&collections)

	assert.ElementsMatch(t, []string{
		CollectionPublicRW, CollectionPublicDeploy, CollectionPublicBoth,
		CollectionPrivate, CollectionHidden,
	}, collectionNames(collections))
}

func TestGetCollections_MemberSeesOnlyItsOwn(t *testing.T) {
	h := NewHarness(t)

	var collections []transport.CollectionOut
	h.GET("/collections", h.Seed.Member.Token).RequireOk(&collections)

	names := collectionNames(collections)

	assert.ElementsMatch(t, []string{
		CollectionPublicRW, CollectionPublicDeploy, CollectionPublicBoth, CollectionPrivate,
	}, names)
	assert.NotContains(t, names, CollectionHidden)
}

func TestGetCollections_OutsiderSeesAnEmptyList(t *testing.T) {
	h := NewHarness(t)

	var collections []transport.CollectionOut
	h.GET("/collections", h.Seed.Outsider.Token).RequireOk(&collections)

	assert.Empty(t, collections)
	// The payload must be an empty array rather than null, which the frontend would choke on.
	assert.Contains(t, h.GET("/collections", h.Seed.Outsider.Token).Body(), `"payload":[]`)
}

func TestGetCollections_IncludesCreatorAndFlags(t *testing.T) {
	h := NewHarness(t)

	var collections []transport.CollectionOut
	h.GET("/collections", h.Seed.Admin.Token).RequireOk(&collections)

	found := findCollection(t, collections, CollectionPublicBoth)

	assert.True(t, found.PublicWrite)
	assert.True(t, found.PublicDeploy)
	assert.Equal(t, h.Seed.Admin.ID(), found.Creator.ID)
	assert.Equal(t, "Admin User", found.Creator.Name)
	assert.NotEmpty(t, found.ID)
}

func TestGetCollections_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.GET("/collections", "").RequireError(http.StatusUnauthorized, 401)
	h.GET("/collections", "garbage").RequireError(498, 498)
}

/*
 * POST /collections
 */

func TestCreateCollection_AdminCanCreate(t *testing.T) {
	h := NewHarness(t)

	var createdID string
	h.POST("/collections", collection.CollectionIn{
		Name:         ptr("brand-new"),
		PublicWrite:  ptr(true),
		PublicDeploy: ptr(false),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)

	stored, err := h.CollectionRepo.GetByUuid(t.Context(), createdID)
	require.NoError(t, err)

	assert.Equal(t, "brand-new", stored.Name)
	assert.True(t, stored.PublicWrite)
	assert.False(t, stored.PublicDeploy)
	assert.Equal(t, h.Seed.Admin.ID(), stored.Creator.UUID)
}

func TestCreateCollection_NonAdminIsForbidden(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/collections", collection.CollectionIn{
		Name:         ptr("member-attempt"),
		PublicWrite:  ptr(true),
		PublicDeploy: ptr(true),
	}, h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "permission to create collections is not granted")
}

func TestCreateCollection_DuplicateNameIsRejected(t *testing.T) {
	h := NewHarness(t)

	response := h.POST("/collections", collection.CollectionIn{
		Name:         ptr(CollectionPrivate),
		PublicWrite:  ptr(true),
		PublicDeploy: ptr(true),
	}, h.Seed.Admin.Token)

	response.RequireError(http.StatusBadRequest, 2001)
}

func TestCreateCollection_MissingRequiredFieldsAreRejected(t *testing.T) {
	h := NewHarness(t)

	bodies := map[string]map[string]any{
		"no name":         {"publicWrite": true, "publicDeploy": true},
		"no publicWrite":  {"name": "x", "publicDeploy": true},
		"no publicDeploy": {"name": "x", "publicWrite": true},
		"empty object":    {},
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			h.POST("/collections", body, h.Seed.Admin.Token).RequireValidationError()
		})
	}
}

func TestCreateCollection_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPost, "/collections", `{"name": `, h.Seed.Admin.Token).RequireValidationError()
}

func TestCreateCollection_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	body := collection.CollectionIn{Name: ptr("x"), PublicWrite: ptr(true), PublicDeploy: ptr(true)}

	h.POST("/collections", body, "").RequireError(http.StatusUnauthorized, 401)
	h.POST("/collections", body, "garbage").RequireError(498, 498)
}

/*
 * PATCH /collections/:collectionId
 */

func TestUpdateCollection_OwnerCanRename(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{
		Name: ptr("renamed-private"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.CollectionRepo.GetByUuid(t.Context(), h.Seed.Private.UUID)
	require.NoError(t, err)
	assert.Equal(t, "renamed-private", stored.Name)
}

func TestUpdateCollection_CanTogglePermissionFlagsIndependently(t *testing.T) {
	h := NewHarness(t)

	t.Run("publicWrite only", func(t *testing.T) {
		h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{
			PublicWrite: ptr(true),
		}, h.Seed.Admin.Token).RequireOk(nil)

		stored, err := h.CollectionRepo.GetByUuid(t.Context(), h.Seed.Private.UUID)
		require.NoError(t, err)

		assert.True(t, stored.PublicWrite)
		assert.False(t, stored.PublicDeploy, "publicDeploy must be untouched")
		assert.Equal(t, CollectionPrivate, stored.Name, "the name must be untouched")
	})

	t.Run("publicDeploy only", func(t *testing.T) {
		h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{
			PublicDeploy: ptr(true),
		}, h.Seed.Admin.Token).RequireOk(nil)

		stored, err := h.CollectionRepo.GetByUuid(t.Context(), h.Seed.Private.UUID)
		require.NoError(t, err)

		assert.True(t, stored.PublicDeploy)
	})
}

func TestUpdateCollection_RenamingToItsOwnNameIsAllowed(t *testing.T) {
	h := NewHarness(t)

	// The duplicate check has to skip the collection being edited, otherwise resubmitting an
	// unchanged form would fail.
	h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{
		Name: ptr(CollectionPrivate),
	}, h.Seed.Admin.Token).RequireOk(nil)
}

func TestUpdateCollection_RenamingToAnExistingNameIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{
		Name: ptr(CollectionPublicBoth),
	}, h.Seed.Admin.Token).RequireError(http.StatusBadRequest, 2001)
}

func TestUpdateCollection_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	response := h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{
		Name: ptr("hijacked"),
	}, h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "write access to the provided collection is not granted")
}

func TestUpdateCollection_AdminCanEditSomeoneElsesCollection(t *testing.T) {
	h := NewHarness(t)

	memberCollection := h.createCollection("member-owned", h.Seed.Member, true, true)

	h.PATCH("/collections/"+memberCollection.UUID, collection.CollectionInPartial{
		Name: ptr("admin-renamed"),
	}, h.Seed.AdminBare.Token).RequireOk(nil)

	stored, err := h.CollectionRepo.GetByUuid(t.Context(), memberCollection.UUID)
	require.NoError(t, err)
	assert.Equal(t, "admin-renamed", stored.Name)
}

func TestUpdateCollection_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/collections/does-not-exist", collection.CollectionInPartial{
		Name: ptr("x"),
	}, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestUpdateCollection_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPatch, "/collections/"+h.Seed.Private.UUID, `{"name":`, h.Seed.Admin.Token).
		RequireValidationError()
}

func TestUpdateCollection_EmptyPatchIsANoOp(t *testing.T) {
	h := NewHarness(t)

	h.PATCH("/collections/"+h.Seed.Private.UUID, collection.CollectionInPartial{}, h.Seed.Admin.Token).
		RequireOk(nil)

	stored, err := h.CollectionRepo.GetByUuid(t.Context(), h.Seed.Private.UUID)
	require.NoError(t, err)

	assert.Equal(t, CollectionPrivate, stored.Name)
	assert.False(t, stored.PublicWrite)
	assert.False(t, stored.PublicDeploy)
}

func TestUpdateCollection_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	body := collection.CollectionInPartial{Name: ptr("x")}

	h.PATCH("/collections/"+h.Seed.Private.UUID, body, "").RequireError(http.StatusUnauthorized, 401)
	h.PATCH("/collections/"+h.Seed.Private.UUID, body, "garbage").RequireError(498, 498)
}

/*
 * DELETE /collections/:collectionId
 */

func TestDeleteCollection_OwnerCanDelete(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/collections/"+h.Seed.Private.UUID, h.Seed.Admin.Token).RequireOk(nil)

	_, err := h.CollectionRepo.GetByUuid(t.Context(), h.Seed.Private.UUID)
	require.Error(t, err, "the collection must be gone")
}

func TestDeleteCollection_AdminCanDeleteSomeoneElsesCollection(t *testing.T) {
	h := NewHarness(t)

	memberCollection := h.createCollection("member-owned", h.Seed.Member, true, true)

	h.DELETE("/collections/"+memberCollection.UUID, h.Seed.AdminBare.Token).RequireOk(nil)

	_, err := h.CollectionRepo.GetByUuid(t.Context(), memberCollection.UUID)
	require.Error(t, err)
}

func TestDeleteCollection_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/collections/"+h.Seed.Private.UUID, h.Seed.Member.Token).
		RequireError(http.StatusForbidden, 403)

	_, err := h.CollectionRepo.GetByUuid(t.Context(), h.Seed.Private.UUID)
	require.NoError(t, err, "the collection must survive a forbidden delete")
}

func TestDeleteCollection_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/collections/does-not-exist", h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestDeleteCollection_DeletingTwiceIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/collections/"+h.Seed.Private.UUID, h.Seed.Admin.Token).RequireOk(nil)
	h.DELETE("/collections/"+h.Seed.Private.UUID, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

// TestDeleteCollection_ReusingADeletedNameFailsWithADatabaseError pins current behaviour, which is
// almost certainly not the intent.
//
// Collection.Name carries a plain `uniqueIndex`, which soft-deleted rows still occupy, but
// Repository.DoesNameExist filters them out with `deleted_at IS NULL`. So the service's duplicate
// check passes and the INSERT then trips the index. The user sees an opaque 500 instead of the 2001
// "a collection with that name already exists", and the name is burned for good.
//
// Fixing it means either a partial unique index (name, deleted_at) or dropping the deleted_at
// filter from DoesNameExist so the clean 2001 is returned.
func TestDeleteCollection_ReusingADeletedNameFailsWithADatabaseError(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/collections/"+h.Seed.Private.UUID, h.Seed.Admin.Token).RequireOk(nil)

	response := h.POST("/collections", collection.CollectionIn{
		Name:         ptr(CollectionPrivate),
		PublicWrite:  ptr(false),
		PublicDeploy: ptr(false),
	}, h.Seed.Admin.Token)

	errorResponse := response.RequireError(http.StatusInternalServerError, 500)
	assert.Contains(t, errorResponse.Message, "database")
}

func TestDeleteCollection_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.DELETE("/collections/"+h.Seed.Private.UUID, "").RequireError(http.StatusUnauthorized, 401)
	h.DELETE("/collections/"+h.Seed.Private.UUID, "garbage").RequireError(498, 498)
}

/*
 * Helpers.
 */

func collectionNames(collections []transport.CollectionOut) []string {
	names := make([]string, 0, len(collections))
	for _, item := range collections {
		names = append(names, item.Name)
	}

	return names
}

func findCollection(t *testing.T, collections []transport.CollectionOut, name string) transport.CollectionOut {
	t.Helper()

	for _, item := range collections {
		if item.Name == name {
			return item
		}
	}

	t.Fatalf("collection %q not found in %v", name, collectionNames(collections))

	return transport.CollectionOut{}
}

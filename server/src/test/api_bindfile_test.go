package test

import (
	"antimonyBackend/domain/topology"
	"antimonyBackend/transport"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func bindFileURL(topologyId string) string {
	return "/topologies/" + topologyId + "/files"
}

func bindFileItemURL(topologyId string, fileId string) string {
	return "/topologies/" + topologyId + "/files/" + fileId
}

// readBindFile reads a bind file's content straight off disk.
func readBindFile(t *testing.T, h *Harness, topologyId string, path string) (string, bool) {
	t.Helper()

	var content string
	if err := h.Storage.ReadBindFile(topologyId, path, &content); err != nil {
		return "", false
	}

	return content, true
}

/*
 * POST /topologies/:topologyId/files
 */

func TestCreateBindFile_OwnerCanCreate(t *testing.T) {
	h := NewHarness(t)

	var createdID string
	h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("host1/interfaces"),
		Content:  ptr("auto eth0\n"),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	require.NotEmpty(t, createdID)

	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), createdID)
	require.NoError(t, err)
	assert.Equal(t, "host1/interfaces", stored.FilePath)

	content, ok := readBindFile(t, h, TopologyAdminID, "host1/interfaces")
	require.True(t, ok, "the bind file must be written to storage")
	assert.Equal(t, "auto eth0\n", content)
}

func TestCreateBindFile_AppearsInTheTopologyResponse(t *testing.T) {
	h := NewHarness(t)

	h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("host1/motd"),
		Content:  ptr("welcome\n"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)

	paths := make(map[string]string, len(topologyOut.BindFiles))
	for _, file := range topologyOut.BindFiles {
		paths[file.FilePath] = file.Content
	}

	assert.Equal(t, "welcome\n", paths["host1/motd"])
	assert.Equal(t, BindFileContent, paths[BindFilePath], "the seeded bind file must still be there")
}

func TestCreateBindFile_DuplicatePathIsRejected(t *testing.T) {
	h := NewHarness(t)

	response := h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr(BindFilePath),
		Content:  ptr("different content"),
	}, h.Seed.Admin.Token)

	response.RequireError(http.StatusBadRequest, 4001)

	// The existing file must not have been overwritten.
	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, BindFileContent, content)
}

func TestCreateBindFile_SamePathOnADifferentTopologyIsAllowed(t *testing.T) {
	h := NewHarness(t)

	// Bind file paths are only unique within a topology.
	var createdID string
	h.POST(bindFileURL(TopologyPrivateID), topology.BindFileIn{
		FilePath: ptr(BindFilePath),
		Content:  ptr("independent content"),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)
}

func TestCreateBindFile_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	response := h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("host1/sneaky"),
		Content:  ptr("x"),
	}, h.Seed.Member.Token)

	errorResponse := response.RequireError(http.StatusForbidden, 403)
	assert.Contains(t, errorResponse.Message, "write access to the provided file is not granted")

	_, ok := readBindFile(t, h, TopologyAdminID, "host1/sneaky")
	assert.False(t, ok, "nothing may be written when the request is refused")
}

func TestCreateBindFile_AdminCanCreateOnSomeoneElsesTopology(t *testing.T) {
	h := NewHarness(t)

	var createdID string
	h.POST(bindFileURL(TopologyMemberID), topology.BindFileIn{
		FilePath: ptr("host1/admin-added"),
		Content:  ptr("x"),
	}, h.Seed.AdminBare.Token).RequireOk(&createdID)

	assert.NotEmpty(t, createdID)
}

func TestCreateBindFile_UnknownTopologyIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.POST(bindFileURL("no-such-topology"), topology.BindFileIn{
		FilePath: ptr("a/b"),
		Content:  ptr("x"),
	}, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestCreateBindFile_MissingRequiredFieldsAreRejected(t *testing.T) {
	h := NewHarness(t)

	bodies := map[string]map[string]any{
		"no filePath":  {"content": "x"},
		"no content":   {"filePath": "a/b"},
		"empty object": {},
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			h.POST(bindFileURL(TopologyAdminID), body, h.Seed.Admin.Token).RequireValidationError()
		})
	}
}

func TestCreateBindFile_EmptyContentIsAllowed(t *testing.T) {
	h := NewHarness(t)

	// An empty string is a legitimate file body, and the required binding only rejects a *missing*
	// field, not an empty one.
	h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("host1/empty"),
		Content:  ptr(""),
	}, h.Seed.Admin.Token).RequireOk(nil)

	content, ok := readBindFile(t, h, TopologyAdminID, "host1/empty")
	require.True(t, ok)
	assert.Empty(t, content)
}

// TestCreateBindFile_PathTraversalEscapesTheStorageDirectory documents a security bug.
//
// Bind file paths are never validated. utils.ErrInvalidBindFilePath exists and is mapped to
// HTTP 400 / code 4002 in utils.CreateErrorResponse, but no code path ever returns it, and there is
// no sanitisation anywhere between the handler and os.WriteFile:
//
//	storage.getBindFilePath -> fmt.Sprintf("%s/%s", topologyId, filePath)
//	storage.write           -> os.MkdirAll(filepath.Dir(path)) + os.WriteFile(path)
//
// filepath.Join collapses the "..", so a relative path escapes both the topology directory and the
// storage root. Any authenticated user who owns a topology (or any admin) can therefore write a
// file of arbitrary content to an arbitrary path the server process can reach, and DELETE on the
// same bind file will unlink it again.
//
// The fix is to reject any path that is not local after cleaning — filepath.IsLocal covers exactly
// this — and to return the already-wired ErrInvalidBindFilePath.
func TestCreateBindFile_PathTraversalEscapesTheStorageDirectory(t *testing.T) {
	h := NewHarness(t)

	storageRoot := h.Config.FileSystem.Storage

	h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("../../escaped.txt"),
		Content:  ptr("written outside the storage root"),
	}, h.Seed.Admin.Token).RequireStatus(http.StatusOK)

	// storage/<topologyId>/../../escaped.txt resolves to the parent of the storage root.
	escaped := filepath.Join(storageRoot, "..", "escaped.txt")

	written, err := os.ReadFile(escaped)
	require.NoErrorf(t, err, "expected the traversal to land at %s", escaped)
	assert.Equal(t, "written outside the storage root", string(written))

	assert.NotContains(t, escaped, filepath.Join(storageRoot, TopologyAdminID),
		"the file must be shown to live outside the topology directory")
}

/*
 * PATCH /topologies/:topologyId/files/:fileId
 */

func TestUpdateBindFile_CanReplaceOnlyTheContent(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		Content: ptr("hostname leaf99\n"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, "hostname leaf99\n", content)

	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.NoError(t, err)
	assert.Equal(t, BindFilePath, stored.FilePath, "the path must be untouched")
}

// TestUpdateBindFile_RenamingWithoutNewContentIsDestructive documents a data-loss bug.
//
// topology.Service.UpdateBindFile deletes the file at the old path *before* deciding where the new
// content comes from. When the request changes only the path (content omitted), the fallback branch
// then tries to read the file it just deleted:
//
//	if bindFile.FilePath != *req.FilePath {
//	    s.removeBindFile(topology, bindFile.FilePath)   // <- old file unlinked here
//	}
//	...
//	if req.Content != nil { ... } else {
//	    s.loadBindFile(topology, *bindFile)             // <- reads the old path, now missing
//	}
//
// The read fails, the handler returns 500, and the update aborts *after* the delete has happened.
// The fix is to load the existing content before removing the old file.
func TestUpdateBindFile_RenamingWithoutNewContentIsDestructive(t *testing.T) {
	h := NewHarness(t)

	response := h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("srl1/renamed.cfg"),
	}, h.Seed.Admin.Token)

	errorResponse := response.RequireError(http.StatusInternalServerError, -1)
	assert.Contains(t, errorResponse.Message, "no such file or directory")

	// The old file is already gone from disk...
	_, oldStillThere := readBindFile(t, h, TopologyAdminID, BindFilePath)
	assert.False(t, oldStillThere, "the old file was deleted before the failure")

	// ...nothing was written at the new path...
	_, newExists := readBindFile(t, h, TopologyAdminID, "srl1/renamed.cfg")
	assert.False(t, newExists, "the rename never completed")

	// ...and the row still points at the path that no longer exists, so the bind file is dangling.
	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.NoError(t, err)
	assert.Equal(t, BindFilePath, stored.FilePath)
}

// TestUpdateBindFile_AFailedRenameBricksTheWholeTopology follows the consequence of the bug above.
//
// Once a bind file row points at a missing file, LoadTopology fails for that topology. GetByUuid
// turns that into 400/3003, and the list endpoint skips the topology entirely (the service logs and
// `continue`s), so it silently vanishes from the client's view. A single failed rename therefore
// makes a topology permanently unreachable through the API even though its definition is intact.
func TestUpdateBindFile_AFailedRenameBricksTheWholeTopology(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("srl1/renamed.cfg"),
	}, h.Seed.Admin.Token).RequireStatus(http.StatusInternalServerError)

	// The single-topology endpoint now reports the topology as invalid.
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireError(http.StatusBadRequest, 3003)

	// And the list endpoint drops it without any indication that something is wrong.
	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&topologies)

	ids := topologyIDs(topologies)
	assert.NotContains(t, ids, TopologyAdminID, "the broken topology disappears from the list")
	assert.Contains(t, ids, TopologyMemberID, "unrelated topologies are unaffected")
}

func TestUpdateBindFile_MovingWithNewContentWorks(t *testing.T) {
	h := NewHarness(t)

	// Supplying content avoids the read-after-delete path, so this is the only rename that works.
	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("srl1/renamed.cfg"),
		Content:  ptr(BindFileContent),
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.NoError(t, err)
	assert.Equal(t, "srl1/renamed.cfg", stored.FilePath)

	moved, ok := readBindFile(t, h, TopologyAdminID, "srl1/renamed.cfg")
	require.True(t, ok, "the file must exist at the new path")
	assert.Equal(t, BindFileContent, moved)

	_, stillThere := readBindFile(t, h, TopologyAdminID, BindFilePath)
	assert.False(t, stillThere, "the file at the old path must be removed")
}

func TestUpdateBindFile_CanChangeBothPathAndContent(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("srl1/both.cfg"),
		Content:  ptr("new content\n"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	content, ok := readBindFile(t, h, TopologyAdminID, "srl1/both.cfg")
	require.True(t, ok)
	assert.Equal(t, "new content\n", content)

	_, stillThere := readBindFile(t, h, TopologyAdminID, BindFilePath)
	assert.False(t, stillThere)
}

func TestUpdateBindFile_KeepingItsOwnPathIsAllowed(t *testing.T) {
	h := NewHarness(t)

	// The duplicate check excludes the bind file being edited.
	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr(BindFilePath),
		Content:  ptr("unchanged path\n"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, "unchanged path\n", content)
}

func TestUpdateBindFile_MovingOntoAnExistingPathIsRejected(t *testing.T) {
	h := NewHarness(t)

	var otherID string
	h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("srl1/other.cfg"),
		Content:  ptr("other\n"),
	}, h.Seed.Admin.Token).RequireOk(&otherID)

	h.PATCH(bindFileItemURL(TopologyAdminID, otherID), topology.BindFileInPartial{
		FilePath: ptr(BindFilePath),
	}, h.Seed.Admin.Token).RequireError(http.StatusBadRequest, 4001)

	// Neither file may have been disturbed.
	seeded, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, BindFileContent, seeded)

	other, ok := readBindFile(t, h, TopologyAdminID, "srl1/other.cfg")
	require.True(t, ok)
	assert.Equal(t, "other\n", other)
}

func TestUpdateBindFile_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		Content: ptr("hijacked"),
	}, h.Seed.Member.Token).RequireError(http.StatusForbidden, 403)

	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, BindFileContent, content, "the content must survive a forbidden update")
}

func TestUpdateBindFile_AdminCanUpdateSomeoneElsesBindFile(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		Content: ptr("admin edited\n"),
	}, h.Seed.AdminBare.Token).RequireOk(nil)

	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, "admin edited\n", content)
}

func TestUpdateBindFile_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, "no-such-file"), topology.BindFileInPartial{
		Content: ptr("x"),
	}, h.Seed.Admin.Token).RequireError(http.StatusNotFound, -1)
}

func TestUpdateBindFile_EmptyPatchKeepsEverything(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{},
		h.Seed.Admin.Token).RequireOk(nil)

	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, BindFileContent, content, "an empty patch must round-trip the existing content")
}

func TestUpdateBindFile_MalformedJsonIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.RawBody(http.MethodPatch, bindFileItemURL(TopologyAdminID, BindFileID), `{"content":`,
		h.Seed.Admin.Token).RequireValidationError()
}

/*
 * DELETE /topologies/:topologyId/files/:fileId
 */

func TestDeleteBindFile_RemovesTheRowAndTheFile(t *testing.T) {
	h := NewHarness(t)

	h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), h.Seed.Admin.Token).RequireOk(nil)

	_, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.Error(t, err, "the row must be gone")

	_, stillThere := readBindFile(t, h, TopologyAdminID, BindFilePath)
	assert.False(t, stillThere, "unlike topologies, deleting a bind file does remove it from disk")
}

func TestDeleteBindFile_DisappearsFromTheTopologyResponse(t *testing.T) {
	h := NewHarness(t)

	h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), h.Seed.Admin.Token).RequireOk(nil)

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)

	assert.Empty(t, topologyOut.BindFiles)
}

func TestDeleteBindFile_NonOwnerIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), h.Seed.Member.Token).
		RequireError(http.StatusForbidden, 403)

	_, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	assert.True(t, ok, "the file must survive a forbidden delete")
}

func TestDeleteBindFile_AdminCanDeleteSomeoneElsesBindFile(t *testing.T) {
	h := NewHarness(t)

	h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), h.Seed.AdminBare.Token).RequireOk(nil)

	_, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.Error(t, err)
}

func TestDeleteBindFile_UnknownIdIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE(bindFileItemURL(TopologyAdminID, "no-such-file"), h.Seed.Admin.Token).
		RequireError(http.StatusNotFound, -1)
}

func TestDeleteBindFile_DeletingTwiceIsNotFound(t *testing.T) {
	h := NewHarness(t)

	h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), h.Seed.Admin.Token).RequireOk(nil)
	h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), h.Seed.Admin.Token).
		RequireError(http.StatusNotFound, -1)
}

func TestBindFileRoutes_RequireAuthentication(t *testing.T) {
	h := NewHarness(t)

	t.Run("create", func(t *testing.T) {
		body := topology.BindFileIn{FilePath: ptr("a/b"), Content: ptr("x")}

		h.POST(bindFileURL(TopologyAdminID), body, "").RequireError(http.StatusUnauthorized, 401)
		h.POST(bindFileURL(TopologyAdminID), body, "garbage").RequireError(498, 498)
	})

	t.Run("update", func(t *testing.T) {
		body := topology.BindFileInPartial{Content: ptr("x")}

		h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), body, "").
			RequireError(http.StatusUnauthorized, 401)
		h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), body, "garbage").RequireError(498, 498)
	})

	t.Run("delete", func(t *testing.T) {
		h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), "").
			RequireError(http.StatusUnauthorized, 401)
		h.DELETE(bindFileItemURL(TopologyAdminID, BindFileID), "garbage").RequireError(498, 498)
	})
}

func TestBindFiles_AreIndependentAcrossTopologies(t *testing.T) {
	h := NewHarness(t)

	// The private topology has no bind files of its own, so the same path can be used there and
	// edited without touching the admin topology's file.
	var createdID string
	h.POST(bindFileURL(TopologyPrivateID), topology.BindFileIn{
		FilePath: ptr(BindFilePath),
		Content:  ptr("private content\n"),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	h.PATCH(bindFileItemURL(TopologyPrivateID, createdID), topology.BindFileInPartial{
		Content: ptr("private updated\n"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	updated, ok := readBindFile(t, h, TopologyPrivateID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, "private updated\n", updated)

	// The identically named file on the admin topology must be untouched.
	original, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok)
	assert.Equal(t, BindFileContent, original)
}

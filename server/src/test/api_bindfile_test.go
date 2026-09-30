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

// TestCreateBindFile_PathTraversalIsRejected covers the path validation on bind file creation.
//
// Bind file paths come straight from the API, so they are attacker controlled. Anything that is not
// a local relative path must be refused with utils.ErrInvalidBindFilePath (400 / code 4002) before
// a single byte is written, so a client cannot reach outside its topology's own directory.
func TestCreateBindFile_PathTraversalIsRejected(t *testing.T) {
	h := NewHarness(t)

	storageRoot := h.Config.FileSystem.Storage

	// The absolute cases point inside the test's own temp tree rather than at a real system path,
	// so that a regression here cannot scribble outside it.
	absoluteInsideTemp := filepath.Join(storageRoot, "..", "absolute-escaped.txt")

	cases := map[string]string{
		"parent traversal":   "../../escaped.txt",
		"single parent":      "../escaped.txt",
		"traversal mid path": "srl1/../../escaped.txt",
		"absolute path":      absoluteInsideTemp,
		"absolute root":      "/escaped.txt",
		"empty path":         "",
		"bare dot dot":       "..",
		"trailing traversal": "srl1/..",
	}

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			response := h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
				FilePath: ptr(path),
				Content:  ptr("should never be written"),
			}, h.Seed.Admin.Token)

			errorResponse := response.RequireError(http.StatusBadRequest, 4002)
			assert.Contains(t, errorResponse.Message, "bind file path was invalid")
		})
	}

	// Nothing may have been written anywhere outside the topology directory.
	for _, escaped := range []string{
		filepath.Join(storageRoot, "..", "escaped.txt"),
		filepath.Join(storageRoot, "escaped.txt"),
		absoluteInsideTemp,
	} {
		_, err := os.Stat(escaped)
		assert.Truef(t, os.IsNotExist(err), "nothing may have been written to %s", escaped)
	}
}

func TestCreateBindFile_NestedRelativePathsAreStillAllowed(t *testing.T) {
	h := NewHarness(t)

	// The validation must not break the nested paths bind files legitimately use.
	for _, path := range []string{
		"config.cfg",
		"srl1/config.cfg",
		"srl1/etc/frr/frr.conf",
	} {
		t.Run(path, func(t *testing.T) {
			var createdID string
			h.POST(bindFileURL(TopologyPrivateID), topology.BindFileIn{
				FilePath: ptr(path),
				Content:  ptr("fine"),
			}, h.Seed.Admin.Token).RequireOk(&createdID)

			stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), createdID)
			require.NoError(t, err)
			assert.Equal(t, path, stored.FilePath)
		})
	}
}

// TestCreateBindFile_PathsAreNormalisedBeforeStorage guards against two spellings of the same path
// aliasing one file.
//
// "./srl1/daemons" and "srl1/daemons" are the same file, but the duplicate-path check compares the
// stored strings, so storing them verbatim would let a client create two rows pointing at one file
// and silently overwrite. Cleaning the path at the boundary makes the stored form canonical.
func TestCreateBindFile_PathsAreNormalisedBeforeStorage(t *testing.T) {
	h := NewHarness(t)

	var createdID string
	h.POST(bindFileURL(TopologyPrivateID), topology.BindFileIn{
		FilePath: ptr("./srl1/../srl1/daemons"),
		Content:  ptr("normalised"),
	}, h.Seed.Admin.Token).RequireOk(&createdID)

	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), createdID)
	require.NoError(t, err)
	assert.Equal(t, "srl1/daemons", stored.FilePath, "the stored path must be the cleaned form")

	content, ok := readBindFile(t, h, TopologyPrivateID, "srl1/daemons")
	require.True(t, ok)
	assert.Equal(t, "normalised", content)

	// And the canonical spelling must now be detected as a duplicate.
	h.POST(bindFileURL(TopologyPrivateID), topology.BindFileIn{
		FilePath: ptr("srl1/daemons"),
		Content:  ptr("second"),
	}, h.Seed.Admin.Token).RequireError(http.StatusBadRequest, 4001)
}

func TestUpdateBindFile_PathTraversalIsRejectedWithoutTouchingTheOldFile(t *testing.T) {
	h := NewHarness(t)

	// The update path removes the old file before writing the new one, so validation has to happen
	// before any of that or a refused rename would still destroy the original.
	response := h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("../../escaped.txt"),
	}, h.Seed.Admin.Token)

	response.RequireError(http.StatusBadRequest, 4002)

	content, ok := readBindFile(t, h, TopologyAdminID, BindFilePath)
	require.True(t, ok, "the original file must survive a refused rename")
	assert.Equal(t, BindFileContent, content)

	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.NoError(t, err)
	assert.Equal(t, BindFilePath, stored.FilePath, "the row must be unchanged")
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

func TestUpdateBindFile_RenamingCarriesTheContentOver(t *testing.T) {
	h := NewHarness(t)

	// Changing only the path must move the file, keeping its content. This requires loading the
	// existing content *before* the old file is removed.
	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("srl1/renamed.cfg"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	stored, err := h.TopologyRepo.GetBindFileByUuid(t.Context(), BindFileID)
	require.NoError(t, err)
	assert.Equal(t, "srl1/renamed.cfg", stored.FilePath)

	moved, ok := readBindFile(t, h, TopologyAdminID, "srl1/renamed.cfg")
	require.True(t, ok, "the file must exist at the new path")
	assert.Equal(t, BindFileContent, moved, "the content must be carried over")

	_, stillThere := readBindFile(t, h, TopologyAdminID, BindFilePath)
	assert.False(t, stillThere, "the file at the old path must be removed")
}

func TestUpdateBindFile_RenamingKeepsTheTopologyReadable(t *testing.T) {
	h := NewHarness(t)

	h.PATCH(bindFileItemURL(TopologyAdminID, BindFileID), topology.BindFileInPartial{
		FilePath: ptr("srl1/renamed.cfg"),
	}, h.Seed.Admin.Token).RequireOk(nil)

	// A rename must leave no dangling row behind: LoadTopology reads every bind file, so a row
	// pointing at a missing file would make the whole topology unreadable.
	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)

	require.Len(t, topologyOut.BindFiles, 1)
	assert.Equal(t, "srl1/renamed.cfg", topologyOut.BindFiles[0].FilePath)
	assert.Equal(t, BindFileContent, topologyOut.BindFiles[0].Content)

	// And it must still be listed.
	var topologies []transport.TopologyOut
	h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&topologies)
	assert.Contains(t, topologyIDs(topologies), TopologyAdminID)
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

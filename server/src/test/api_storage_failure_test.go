package test

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony-server/domain/topology"
	"github.com/antimony-team/antimony-server/transport"
)

// storageErrorCode is the code of utils.ErrFileStorage, which falls through to the code of unknown errors.
const storageErrorCode = -1

// makeStorageReadOnly makes the storage directory of the harness and everything in it unwritable for the rest
// of the test. The files are written before the database rows, so a failed write must leave nothing behind.
func makeStorageReadOnly(t *testing.T, h *Harness) {
	t.Helper()

	if os.Geteuid() == 0 {
		t.Skip("root can write to read-only directories")
	}

	storagePath := h.Config.FileSystem.Storage
	setModes := func(directoryMode fs.FileMode, fileMode fs.FileMode) {
		_ = filepath.WalkDir(storagePath, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				_ = os.Chmod(path, directoryMode)
			} else {
				_ = os.Chmod(path, fileMode)
			}
			return nil
		})
	}

	setModes(0o555, 0o444)
	// The temporary directory can only be removed once it is writable again
	t.Cleanup(func() { setModes(0o755, 0o644) })
}

func TestCreateTopology_AFailedWriteLeavesNoTopologyBehind(t *testing.T) {
	h := NewHarness(t)

	var before []transport.TopologyOut
	h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&before)

	makeStorageReadOnly(t, h)

	h.POST("/topologies", topology.TopologyIn{
		Definition:   ptr("name: unwritten\ntopology:\n  nodes:\n    a:\n      kind: linux\n"),
		Annotations:  ptr(EmptyTopologyAnnotations),
		SyncUrl:      ptr(""),
		CollectionId: ptr(h.Seed.PublicBoth.UUID),
	}, h.Seed.Admin.Token).RequireError(http.StatusInternalServerError, storageErrorCode)

	var after []transport.TopologyOut
	h.GET("/topologies", h.Seed.Admin.Token).RequireOk(&after)
	assert.Len(t, after, len(before), "a topology without its files must not be stored")
}

func TestUpdateTopology_AFailedWriteKeepsTheTopologyAsItWas(t *testing.T) {
	h := NewHarness(t)
	makeStorageReadOnly(t, h)

	h.PATCH("/topologies/"+TopologyAdminID, topology.TopologyInPartial{
		Definition: ptr("name: renamed\ntopology:\n  nodes:\n    a:\n      kind: linux\n"),
	}, h.Seed.Admin.Token).RequireError(http.StatusInternalServerError, storageErrorCode)

	stored, err := h.TopologyRepo.GetByUuid(t.Context(), TopologyAdminID)
	require.NoError(t, err)
	assert.Equal(t, "admin-topo", stored.Name, "the name must not change if the definition wasn't written")

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)
	assert.Equal(t, AdminTopologyDefinition, topologyOut.Definition)
}

func TestCreateBindFile_AFailedWriteLeavesNoBindFileBehind(t *testing.T) {
	h := NewHarness(t)
	makeStorageReadOnly(t, h)

	h.POST(bindFileURL(TopologyAdminID), topology.BindFileIn{
		FilePath: ptr("configs/unwritten.cfg"),
		Content:  ptr("hostname r1"),
	}, h.Seed.Admin.Token).RequireError(http.StatusInternalServerError, storageErrorCode)

	var topologyOut transport.TopologyOut
	h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)
	require.Len(t, topologyOut.BindFiles, 1, "only the seeded bind file must exist")
	assert.Equal(t, BindFilePath, topologyOut.BindFiles[0].FilePath)
}

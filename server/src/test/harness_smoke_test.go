package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/transport"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHarness_Smoke checks that the harness wires up a usable service graph: the fixtures land in
// the database and on disk, the HTTP stack answers with the expected envelopes, the socket stack
// accepts an authenticated client, and the dummy provider is reachable through a real command.
func TestHarness_Smoke(t *testing.T) {
	h := NewHarness(t)

	t.Run("fixtures are seeded", func(t *testing.T) {
		var collections []transport.CollectionOut
		h.GET("/collections", h.Seed.Admin.Token).RequireOk(&collections)

		names := make([]string, 0, len(collections))
		for _, item := range collections {
			names = append(names, item.Name)
		}

		assert.ElementsMatch(t, []string{
			CollectionPublicRW, CollectionPublicDeploy, CollectionPublicBoth,
			CollectionPrivate, CollectionHidden,
		}, names)
	})

	t.Run("topology definitions validate against the clab schema", func(t *testing.T) {
		for name, definition := range map[string]string{
			"admin":   AdminTopologyDefinition,
			"member":  MemberTopologyDefinition,
			"private": PrivateTopologyDefinition,
			"hidden":  HiddenTopologyDefinition,
		} {
			_, err := h.SchemaService.Parse(definition)
			assert.NoErrorf(t, err, "the %s topology fixture must be schema valid", name)
		}
	})

	t.Run("bind file content is readable through the API", func(t *testing.T) {
		var topologyOut transport.TopologyOut
		h.GET("/topologies/"+TopologyAdminID, h.Seed.Admin.Token).RequireOk(&topologyOut)

		require.Len(t, topologyOut.BindFiles, 1)
		assert.Equal(t, BindFilePath, topologyOut.BindFiles[0].FilePath)
		assert.Equal(t, BindFileContent, topologyOut.BindFiles[0].Content)
	})

	t.Run("unauthenticated requests are rejected", func(t *testing.T) {
		h.GET("/collections", "").RequireError(http.StatusUnauthorized, 401)
	})

	t.Run("socket client can connect and reach the command namespace", func(t *testing.T) {
		client := h.Dial("/cmd", h.Seed.Admin.Token)

		// A payload without a command is rejected by the handler, which proves the whole path works:
		// handshake, middleware, JSON-string decoding, dispatch and the ack envelope.
		client.Emit(map[string]any{"labId": LabAdminID}).RequireError(5422)
	})

	t.Run("a lab deploys through the dummy provider", func(t *testing.T) {
		updates := h.Dial("/lab-updates", h.Seed.Admin.Token)
		client := h.Dial("/cmd", h.Seed.Admin.Token)

		client.Emit(deployCommand(LabAdminID)).RequireOk(nil)

		assert.Equal(t, 1, h.Provider.CallCount("Deploy"))
		assert.True(t, h.Provider.HasInstance(InstanceAdminLab))

		node := h.Provider.Node(InstanceAdminLab, NodeHost)
		require.NotNil(t, node)
		assert.Equal(t, deployment.NodeStates.Running, node.State)

		var update instanceUpdatePayload
		updates.NextPayload(&update)
		require.NotNil(t, update.LabId)
		assert.Equal(t, LabAdminID, *update.LabId)
	})
}

// instanceUpdatePayload mirrors the unexported instance update message sent on /lab-updates.
type instanceUpdatePayload struct {
	LabId *string `json:"labId"`
}

/*
 * Socket command payload builders, shared by the socket tests.
 *
 * The command numbers mirror the unexported RuntimeCommand iota in runtime/commands.
 */

const (
	cmdDeployLab   = 0
	cmdDestroyLab  = 1
	cmdStartNode   = 2
	cmdStopNode    = 3
	cmdRestartNode = 4
	cmdFetchShells = 5
	cmdOpenShell   = 6
	cmdCloseShell  = 7
	cmdResizeShell = 8
)

// The terminal size the shell commands open shells with, unless a test asks for another one.
const (
	defaultShellCols = 80
	defaultShellRows = 24
)

func deployCommand(labId string) map[string]any {
	return map[string]any{"labId": labId, "command": cmdDeployLab}
}

func destroyCommand(labId string) map[string]any {
	return map[string]any{"labId": labId, "command": cmdDestroyLab}
}

func nodeCommand(command int, labId string, node string) map[string]any {
	return map[string]any{"labId": labId, "command": command, "node": node}
}

func fetchShellsCommand(labId string) map[string]any {
	return map[string]any{"labId": labId, "command": cmdFetchShells}
}

func openShellCommand(labId string, node string) map[string]any {
	return openShellCommandWithSize(labId, node, defaultShellCols, defaultShellRows)
}

func openShellCommandWithSize(labId string, node string, cols int, rows int) map[string]any {
	return map[string]any{"labId": labId, "command": cmdOpenShell, "node": node, "cols": cols, "rows": rows}
}

func closeShellCommand(labId string, shellId string) map[string]any {
	return map[string]any{"labId": labId, "command": cmdCloseShell, "shellId": shellId}
}

// resizeShellCommand addresses the shell by its id alone, resizing doesn't need the lab.
func resizeShellCommand(shellId string, cols int, rows int) map[string]any {
	return map[string]any{"command": cmdResizeShell, "shellId": shellId, "cols": cols, "rows": rows}
}

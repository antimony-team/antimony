package test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/antimony-team/antimony-server/clabtypes"
)

// TestFixtures_TopologyDefinitionsAreSchemaValid checks the fixture definitions against the clab schema, so a schema
// update that rejects them fails here instead of in every test that creates a topology from them.
func TestFixtures_TopologyDefinitionsAreSchemaValid(t *testing.T) {
	h := NewHarness(t)

	for name, definition := range map[string]string{
		"admin":   AdminTopologyDefinition,
		"member":  MemberTopologyDefinition,
		"private": PrivateTopologyDefinition,
		"hidden":  HiddenTopologyDefinition,
	} {
		var parsed clabtypes.TopologyDefinition
		err := h.SchemaService.Parse(definition, &parsed, new(any))
		assert.NoErrorf(t, err, "the %s topology fixture must be schema valid", name)
	}
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

package test

import (
	"antimonyBackend/deployment"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// shellControlDTO mirrors the unexported shellControlData sent on /shell-control.
type shellControlDTO struct {
	LabId   string `json:"labId"`
	Command int    `json:"command"`
	Node    string `json:"node"`
	ShellId string `json:"shellId"`
	Message string `json:"message"`
}

// shellDataDTO mirrors the unexported shellData returned by fetchShells.
type shellDataDTO struct {
	Id   string `json:"id"`
	Node string `json:"node"`
}

// Values of the unexported shellCommand iota in runtime/shell.
const (
	shellControlError = 0
	shellControlClose = 1
)

// openShell opens a shell on a node and returns its id.
func openShell(t *testing.T, client *SocketClient, labId string, node string) string {
	t.Helper()

	var shellId string
	client.Emit(openShellCommand(labId, node)).RequireOk(&shellId)
	require.NotEmpty(t, shellId)

	return shellId
}

/*
 * fetchShells
 */

func TestFetchShellsCommand_ReturnsNothingWhenNoShellsAreOpen(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	var shells []shellDataDTO
	client.Emit(fetchShellsCommand(LabAdminID)).RequireOk(&shells)

	assert.Empty(t, shells)
}

func TestFetchShellsCommand_ListsTheCallersShells(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	first := openShell(t, client, LabAdminID, NodeHost)
	second := openShell(t, client, LabAdminID, NodeSRL)

	var shells []shellDataDTO
	client.Emit(fetchShellsCommand(LabAdminID)).RequireOk(&shells)

	require.Len(t, shells, 2)

	byId := make(map[string]string, len(shells))
	for _, shell := range shells {
		byId[shell.Id] = shell.Node
	}

	assert.Equal(t, NodeHost, byId[first])
	assert.Equal(t, NodeSRL, byId[second])
}

func TestFetchShellsCommand_DoesNotLeakOtherUsersShells(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabMemberID)

	// The member owns the lab and opens a shell on it.
	memberClient := h.Dial("/cmd", h.Seed.Member.Token)
	memberShell := openShell(t, memberClient, LabMemberID, NodeHost)

	// An admin has access to the lab, but the shell is not theirs.
	adminClient := h.Dial("/cmd", h.Seed.Admin.Token)

	var adminShells []shellDataDTO
	adminClient.Emit(fetchShellsCommand(LabMemberID)).RequireOk(&adminShells)

	assert.Empty(t, adminShells, "shells are listed per owner, even for admins")

	var memberShells []shellDataDTO
	memberClient.Emit(fetchShellsCommand(LabMemberID)).RequireOk(&memberShells)

	require.Len(t, memberShells, 1)
	assert.Equal(t, memberShell, memberShells[0].Id)
}

func TestFetchShellsCommand_IsScopedToTheRequestedLab(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)
	h.DeployLab(LabPastID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	openShell(t, client, LabAdminID, NodeHost)

	var shells []shellDataDTO
	client.Emit(fetchShellsCommand(LabPastID)).RequireOk(&shells)

	assert.Empty(t, shells, "a shell on one lab must not show up under another")
}

func TestFetchShellsCommand_WithoutCollectionAccessIsForbidden(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabHiddenID)

	client := h.Dial("/cmd", h.Seed.Member.Token)

	// fetchShells authorises on collection membership rather than ownership.
	errorResponse := client.Emit(fetchShellsCommand(LabHiddenID)).RequireError(5403)
	assert.Contains(t, errorResponse.Message, "access to the provided lab is not granted")
}

func TestFetchShellsCommand_UnknownLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// The shell service surfaces the repository error directly, so this is 5404 rather than the
	// 5011 the lab commands return for the same mistake.
	client.Emit(fetchShellsCommand("no-such-lab")).RequireError(5404)
}

func TestFetchShellsCommand_WorksOnALabThatIsNotRunning(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	// fetchShells never consults the runtime, so it answers with an empty list rather than 5012.
	var shells []shellDataDTO
	client.Emit(fetchShellsCommand(LabAdminID)).RequireOk(&shells)

	assert.Empty(t, shells)
}

/*
 * openShell
 */

func TestOpenShellCommand_OpensAShellOnARunningNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	// The SSH attempt fails because the dummy refuses DialNode, so the service falls back to an
	// interactive exec on the node.
	assert.True(t, h.Provider.WasCalled("DialNode"), "SSH is attempted first")

	call := h.Provider.LastCall("ExecInteractive")
	require.NotNil(t, call, "the service must fall back to an interactive exec")
	assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
	assert.Equal(t, NodeHost, call.Args["nodeName"])

	// And the shell's own namespace must now accept its owner.
	dataClient, err := h.TryDial("/shell/"+shellId, h.Seed.Admin.Token)
	require.NoError(t, err)
	require.NotNil(t, dataClient)
}

func TestOpenShellCommand_FallsBackToShWhenBashIsUnavailable(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	openShell(t, client, LabAdminID, NodeHost)

	call := h.Provider.LastCall("ExecInteractive")
	require.NotNil(t, call)

	cmd, ok := call.Args["cmd"].([]string)
	require.True(t, ok)
	require.Len(t, cmd, 3)

	// The command tries bash and degrades to sh inside the node itself.
	assert.Equal(t, "sh", cmd[0])
	assert.Equal(t, "-c", cmd[1])
	assert.Contains(t, cmd[2], "command -v bash")
	assert.Contains(t, cmd[2], "exec sh")
}

func TestOpenShellCommand_MissingNodeIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(map[string]any{"labId": LabAdminID, "command": cmdOpenShell}).RequireError(5422)
}

func TestOpenShellCommand_NonRunningLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(openShellCommand(LabAdminID, NodeHost)).RequireError(5012)
	assert.Contains(t, errorResponse.Message, "lab is not running")
}

func TestOpenShellCommand_UnknownNodeIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(openShellCommand(LabAdminID, "no-such-node")).RequireError(5021)
}

func TestOpenShellCommand_UnknownLabIsRejected(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(openShellCommand("no-such-lab", NodeHost)).RequireError(5404)
}

func TestOpenShellCommand_NonOwnerIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Member.Token)

	errorResponse := client.Emit(openShellCommand(LabAdminID, NodeHost)).RequireError(5403)
	assert.Contains(t, errorResponse.Message, "deploy access to the provided lab is not granted")
}

func TestOpenShellCommand_AdminCanOpenAShellOnSomeoneElsesLab(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabMemberID)

	client := h.Dial("/cmd", h.Seed.AdminBare.Token)

	shellId := openShell(t, client, LabMemberID, NodeHost)
	assert.NotEmpty(t, shellId)
}

func TestOpenShellCommand_EnforcesThePerUserLimit(t *testing.T) {
	h := NewHarness(t, WithShellLimits(2, 1800))

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	openShell(t, client, LabAdminID, NodeHost)
	openShell(t, client, LabAdminID, NodeSRL)

	errorResponse := client.Emit(openShellCommand(LabAdminID, NodeHost)).RequireError(5032)
	assert.Contains(t, errorResponse.Message, "shell limit reached")
}

func TestOpenShellCommand_TheLimitIsPerUserNotGlobal(t *testing.T) {
	h := NewHarness(t, WithShellLimits(1, 1800))

	h.DeployLab(LabAdminID)
	h.DeployLab(LabMemberID)

	adminClient := h.Dial("/cmd", h.Seed.Admin.Token)
	memberClient := h.Dial("/cmd", h.Seed.Member.Token)

	openShell(t, adminClient, LabAdminID, NodeHost)

	// The admin has used their allowance; the member still has their own.
	adminClient.Emit(openShellCommand(LabAdminID, NodeSRL)).RequireError(5032)
	openShell(t, memberClient, LabMemberID, NodeHost)
}

func TestOpenShellCommand_ClosingAShellFreesAnAllowanceSlot(t *testing.T) {
	h := NewHarness(t, WithShellLimits(1, 1800))

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	shellId := openShell(t, client, LabAdminID, NodeHost)
	client.Emit(openShellCommand(LabAdminID, NodeSRL)).RequireError(5032)

	client.Emit(closeShellCommand(LabAdminID, shellId)).RequireOk(nil)

	openShell(t, client, LabAdminID, NodeSRL)
}

func TestOpenShellCommand_ProviderFailureIsReported(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	h.Provider.ExecInteractiveFn = func(string, string, []string) (deployment.ShellExecSession, error) {
		return nil, deployment.ErrDummyProvider
	}

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	client.Emit(openShellCommand(LabAdminID, NodeHost)).RequireError(5000)
}

/*
 * closeShell
 */

func TestCloseShellCommand_ClosesTheSession(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)
	require.False(t, session.IsClosed())

	client.Emit(closeShellCommand(LabAdminID, shellId)).RequireOk(nil)

	assert.True(t, session.IsClosed(), "the underlying session must be closed")

	// And it must be gone from the user's shell list.
	var shells []shellDataDTO
	client.Emit(fetchShellsCommand(LabAdminID)).RequireOk(&shells)
	assert.Empty(t, shells)
}

func TestCloseShellCommand_AnnouncesTheCloseOnTheControlNamespace(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	control := h.Dial("/shell-control", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	shellId := openShell(t, client, LabAdminID, NodeHost)
	client.Emit(closeShellCommand(LabAdminID, shellId)).RequireOk(nil)

	// Closing a shell announces it twice. CloseShellCommand sends "closed by the user" and then
	// closes the session, whereupon runShell sees EOF and announces the close a second time with
	// "The connection has been terminated". Both carry the same shell id, so a client that acts on
	// the first gets a redundant second event. Collect both rather than assuming an order.
	events := CollectPayloads[shellControlDTO](control, 2)

	messages := make([]string, 0, len(events))
	for _, event := range events {
		assert.Equal(t, shellControlClose, event.Command)
		assert.Equal(t, shellId, event.ShellId)
		assert.Equal(t, LabAdminID, event.LabId)
		assert.Equal(t, NodeHost, event.Node)

		messages = append(messages, event.Message)
	}

	assert.Contains(t, messages, "shell was closed by the user")
	assert.Contains(t, messages, "The connection has been terminated")
}

func TestCloseShellCommand_MissingShellIdIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(map[string]any{
		"labId":   LabAdminID,
		"command": cmdCloseShell,
	}).RequireError(5422)

	assert.Contains(t, errorResponse.Message, "socket request was invalid")
}

func TestCloseShellCommand_UnknownShellIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)

	errorResponse := client.Emit(closeShellCommand(LabAdminID, "no-such-shell")).RequireError(5031)
	assert.Contains(t, errorResponse.Message, "shell id does not exist")
}

func TestCloseShellCommand_ClosingTwiceIsRejected(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	client.Emit(closeShellCommand(LabAdminID, shellId)).RequireOk(nil)
	client.Emit(closeShellCommand(LabAdminID, shellId)).RequireError(5031)
}

func TestCloseShellCommand_AnotherUserCannotCloseSomeoneElsesShell(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabMemberID)

	memberClient := h.Dial("/cmd", h.Seed.Member.Token)
	shellId := openShell(t, memberClient, LabMemberID, NodeHost)

	// A different non-admin user must not be able to close it.
	outsiderClient := h.Dial("/cmd", h.Seed.Outsider.Token)

	errorResponse := outsiderClient.Emit(closeShellCommand(LabMemberID, shellId)).RequireError(5403)
	assert.Contains(t, errorResponse.Message, "access to the provided shell is not granted")

	session := h.Provider.Shell(InstanceMemberLab, NodeHost)
	require.NotNil(t, session)
	assert.False(t, session.IsClosed(), "the shell must survive the refused close")
}

func TestCloseShellCommand_AdminCanCloseAnyShell(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabMemberID)

	memberClient := h.Dial("/cmd", h.Seed.Member.Token)
	shellId := openShell(t, memberClient, LabMemberID, NodeHost)

	adminClient := h.Dial("/cmd", h.Seed.Admin.Token)
	adminClient.Emit(closeShellCommand(LabMemberID, shellId)).RequireOk(nil)

	session := h.Provider.Shell(InstanceMemberLab, NodeHost)
	require.NotNil(t, session)
	assert.True(t, session.IsClosed())
}

// TestCloseShellCommand_OwnerCanCloseFromASecondConnection guards the fix for an ownership check
// that used to compare *auth.AuthenticatedUser pointers.
//
// The socket manager hands out a fresh AuthenticatedUser per connection, so the pointer captured
// when the shell was opened never matched the one on a later connection. A user who opened a shell
// in one browser tab could not close it from another.
func TestCloseShellCommand_OwnerCanCloseFromASecondConnection(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabMemberID)

	opener := h.Dial("/cmd", h.Seed.Member.Token)
	shellId := openShell(t, opener, LabMemberID, NodeHost)

	// A second connection for the very same non-admin user.
	closer := h.Dial("/cmd", h.Seed.Member.Token)
	closer.Emit(closeShellCommand(LabMemberID, shellId)).RequireOk(nil)

	session := h.Provider.Shell(InstanceMemberLab, NodeHost)
	require.NotNil(t, session)
	assert.True(t, session.IsClosed())
}

/*
 * Shell data streaming.
 *
 * The shell data namespace is an IONamespace[string, byte]: because its input type is string it
 * uses raw input, so a client sends keystrokes as a bare string rather than as JSON. Output is raw
 * too, so node output arrives as binary rather than wrapped in a payload envelope.
 */

func TestShellData_ClientInputReachesTheNode(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)

	dataClient := h.Dial("/shell/"+shellId, h.Seed.Admin.Token)

	dataClient.EmitRawWithoutAck("ls -la\n")

	requireEventually(t, func() bool {
		return session.Written() == "ls -la\n"
	}, "the keystrokes must be written to the node session")
}

func TestShellData_NodeOutputReachesTheClient(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	dataClient := h.Dial("/shell/"+shellId, h.Seed.Admin.Token)

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)

	// The client is registered on the server slightly after Dial returns, so keep offering output
	// until it lands rather than racing the registration. Each attempt is a full round trip through
	// a binary socket.io frame, so this gets a longer budget than the default.
	var received []byte

	requireEventuallyWithin(t, 20*time.Second, func() bool {
		session.Push("total 0\n")

		value, ok := dataClient.NextDataWithin(300 * time.Millisecond)
		if !ok {
			return false
		}

		received = SocketBytes(t, value)

		return true
	}, "node output must reach a subscribed client")

	assert.Equal(t, "total 0\n", string(received))
}

func TestShellData_EmptyPayloadIsAccepted(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	dataClient := h.Dial("/shell/"+shellId, h.Seed.Admin.Token)

	// An empty string is a valid raw payload; it simply writes nothing.
	dataClient.EmitRawWithoutAck("")

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)

	dataClient.ExpectNoData()
	assert.Empty(t, session.Written())
}

func TestShellData_SessionEndAnnouncesAClose(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	control := h.Dial("/shell-control", h.Seed.Admin.Token)
	client := h.Dial("/cmd", h.Seed.Admin.Token)

	shellId := openShell(t, client, LabAdminID, NodeHost)

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)

	// Closing the node side makes the reader see EOF, which tears the shell down.
	require.NoError(t, session.Close())

	var event shellControlDTO
	control.NextPayload(&event)

	assert.Equal(t, shellControlClose, event.Command)
	assert.Equal(t, shellId, event.ShellId)
	assert.Contains(t, event.Message, "connection has been terminated")

	// The shell must no longer be listed.
	var shells []shellDataDTO
	client.Emit(fetchShellsCommand(LabAdminID)).RequireOk(&shells)
	assert.Empty(t, shells)
}

func TestShellData_SessionEndDisconnectsSubscribers(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	dataClient := h.Dial("/shell/"+shellId, h.Seed.Admin.Token)

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)
	require.NoError(t, session.Close())

	// Tearing the shell down calls Release on its data namespace, which clears the listeners and
	// disconnects every subscriber rather than leaving them attached to a dead shell.
	require.True(t, dataClient.WaitForDisconnect(),
		"a subscriber must be disconnected when the shell ends")
}

func TestShellData_HasABacklogOfPreviousOutput(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeHost)

	session := h.Provider.Shell(InstanceAdminLab, NodeHost)
	require.NotNil(t, session)

	// Output produced before anyone subscribes must be replayed from the byte ring.
	session.Push("line one\n")
	session.Push("line two\n")

	requireEventually(t, func() bool {
		late := h.Dial("/shell/"+shellId, h.Seed.Admin.Token)

		value, ok := late.NextBacklogWithin(200 * time.Millisecond)
		if !ok {
			return false
		}

		replayed := string(SocketBytes(t, value))

		return strings.Contains(replayed, "line one") && strings.Contains(replayed, "line two")
	}, "a late subscriber must receive the shell backlog")
}

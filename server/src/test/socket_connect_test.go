package test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * Handshake authentication.
 *
 * Every production namespace is authenticated, so socket.Manager.SocketAuthenticatorMiddleware runs
 * on each connection and rejects it with an ExtendedError the client surfaces as "connect_error".
 *
 * A note on what these tests can assert. The server builds its rejection with
 * socketio.NewExtendedError("Unauthorized", nil), and the socket.io-client-go parser refuses an
 * error packet whose `data` field is nil ("invalid type for 'data' field"). So this Go client can
 * observe *that* a connection was refused but not *why*. The reason is only reachable from a client
 * that tolerates the nil data field, which the browser client does.
 *
 * The reasons themselves are pinned by TestSocketConnect_RejectionReasonsAreWhatTheInterfaceExpects,
 * which reads them off the wire with Harness.RawConnectError.
 */

func TestSocketConnect_ValidTokenIsAccepted(t *testing.T) {
	h := NewHarness(t)

	client, err := h.TryDial("/cmd", h.Seed.Admin.Token)

	require.NoError(t, err)
	require.NotNil(t, client)
}

func TestSocketConnect_MissingAuthPayloadIsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	_, err := h.TryDialWithAuth("/cmd", nil)

	require.Error(t, err, "a client with no auth payload must be refused")
}

func TestSocketConnect_AuthPayloadWithoutATokenIsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	_, err := h.TryDialWithAuth("/cmd", map[string]any{"somethingElse": "value"})

	require.Error(t, err)
}

func TestSocketConnect_NonStringTokenIsUnauthorized(t *testing.T) {
	h := NewHarness(t)

	// parseHandshake requires the token to be a string; anything else is treated as absent.
	_, err := h.TryDialWithAuth("/cmd", map[string]any{"token": 12345})

	require.Error(t, err)
}

func TestSocketConnect_MalformedTokenIsRejected(t *testing.T) {
	h := NewHarness(t)

	_, err := h.TryDial("/cmd", "this-is-not-a-jwt")

	require.Error(t, err)
}

func TestSocketConnect_EmptyTokenIsRejected(t *testing.T) {
	h := NewHarness(t)

	_, err := h.TryDial("/cmd", "")

	require.Error(t, err)
}

func TestSocketConnect_TokenForAnUnregisteredUserIsRejected(t *testing.T) {
	h := NewHarness(t)

	// The signature verifies but the auth manager has no permissions on file for this user, which
	// is the same failure the HTTP middleware reports as 498.
	_, err := h.TryDial("/cmd", h.UnregisteredToken("ghost-user"))

	require.Error(t, err)
}

func TestSocketConnect_TokenSignedWithTheWrongSecretIsRejected(t *testing.T) {
	h := NewHarness(t)

	token := signToken(t, "not-the-server-secret", map[string]any{
		"id":  h.Seed.Admin.ID(),
		"exp": 9999999999,
		"nbf": 0,
	})

	_, err := h.TryDial("/cmd", token)

	require.Error(t, err)
}

func TestSocketConnect_UpgradesFromAnotherOriginAreAccepted(t *testing.T) {
	h := NewHarness(t)

	// Browsers send an Origin header, and the interface is often served from a different origin than
	// the API, e.g. by the Vite dev server proxying to the backend. The Go client sends no Origin at
	// all, so without this test a check that ties the upgrade to the Host header goes unnoticed.
	url := "ws" + strings.TrimPrefix(h.Server.URL, "http") + "/socket.io/?EIO=4&transport=websocket"
	conn, response, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": {"http://localhost:8080"}})
	if response != nil {
		defer response.Body.Close()
	}

	require.NoError(t, err, "the websocket upgrade must not depend on the Origin header")
	defer conn.Close()
}

func TestSocketConnect_RejectionReasonsAreWhatTheInterfaceExpects(t *testing.T) {
	h := NewHarness(t)

	// data-binder.ts in the interface matches these texts exactly: "Invalid Token" makes it refresh
	// the access token and reconnect, "Invalid namespace" makes it retry later. Changing them breaks
	// the client without failing any other test.
	cases := []struct {
		name      string
		namespace string
		auth      map[string]any
		reason    string
	}{
		{"a valid token is accepted", "/cmd", map[string]any{"token": h.Seed.Admin.Token}, ""},
		{"no auth payload", "/cmd", nil, "Unauthorized"},
		{"an auth payload without a token", "/cmd", map[string]any{"somethingElse": "value"}, "Unauthorized"},
		{"an invalid token", "/cmd", map[string]any{"token": "this-is-not-a-jwt"}, "Invalid Token"},
		{"an unknown namespace", "/not-a-namespace", map[string]any{"token": h.Seed.Admin.Token}, "Invalid namespace"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.reason, h.RawConnectError(c.namespace, c.auth))
		})
	}
}

func TestSocketConnect_EveryProductionNamespaceRequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	for _, namespace := range []string{"/cmd", "/lab-updates", "/status-messages", "/shell-control"} {
		t.Run(namespace, func(t *testing.T) {
			_, err := h.TryDialWithAuth(namespace, nil)
			require.Errorf(t, err, "%s must not accept an anonymous client", namespace)

			client, err := h.TryDial(namespace, h.Seed.Member.Token)
			require.NoErrorf(t, err, "%s must accept an authenticated client", namespace)
			assert.NotNil(t, client)
		})
	}
}

func TestSocketConnect_NonAdminCanConnectToTheCommandNamespace(t *testing.T) {
	h := NewHarness(t)

	// The /cmd namespace has no access group, so any authenticated user may connect. Authorisation
	// happens per command instead.
	client, err := h.TryDial("/cmd", h.Seed.Outsider.Token)

	require.NoError(t, err)
	require.NotNil(t, client)
}

func TestSocketConnect_TheSameUserMayOpenSeveralConnections(t *testing.T) {
	h := NewHarness(t)

	first := h.Dial("/lab-updates", h.Seed.Admin.Token)
	second := h.Dial("/lab-updates", h.Seed.Admin.Token)

	require.NotNil(t, first)
	require.NotNil(t, second)

	// Broadcasts reach every connection. The namespace tracks connections in a slice for
	// broadcasts and in a map keyed by user ID for targeted sends, so the second connection
	// replaces the first in the map while both stay in the slice.
	h.DeployLab(LabAdminID)

	first.NextData()
	second.NextData()
}

func TestSocketConnect_DisconnectStopsDelivery(t *testing.T) {
	h := NewHarness(t)

	client := h.Dial("/lab-updates", h.Seed.Admin.Token)
	observer := h.Dial("/lab-updates", h.Seed.Member.Token)

	client.Close()

	// The remaining client still receives broadcasts, which proves the disconnect removed only the
	// closed connection from the namespace.
	h.DeployLab(LabAdminID)

	observer.NextData()
}

/*
 * Access groups.
 *
 * Shell data namespaces are created with an access group holding exactly the user who opened the
 * shell, so nobody else can subscribe to their terminal.
 */

func TestSocketConnect_ShellNamespaceIsRestrictedToItsOwner(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	commands := h.Dial("/cmd", h.Seed.Admin.Token)

	var shellId string
	commands.Emit(openShellCommand(LabAdminID, NodeHost)).RequireOk(&shellId)
	require.NotEmpty(t, shellId)

	t.Run("the owner may connect", func(t *testing.T) {
		client, err := h.TryDial("/shell/"+shellId, h.Seed.Admin.Token)

		require.NoError(t, err)
		assert.NotNil(t, client)
	})

	t.Run("another user may not", func(t *testing.T) {
		_, err := h.TryDial("/shell/"+shellId, h.Seed.Member.Token)

		require.Error(t, err, "a user who does not own the shell must be refused")
	})

	t.Run("an admin who does not own the shell may not either", func(t *testing.T) {
		// The access group is membership based, so the admin flag does not help here.
		_, err := h.TryDial("/shell/"+shellId, h.Seed.AdminBare.Token)

		require.Error(t, err)
	})
}

func TestSocketConnect_UnknownNamespaceIsRefused(t *testing.T) {
	h := NewHarness(t)

	// Namespaces exist only once the server has registered them, so a client cannot subscribe to a
	// shell that was never opened, nor to the log stream of a lab that was never deployed.
	for _, namespace := range []string{
		"/shell/no-such-shell",
		"/logs/no-such-lab",
		"/stats/no-such-container",
		"/not-a-namespace",
	} {
		t.Run(namespace, func(t *testing.T) {
			_, err := h.TryDial(namespace, h.Seed.Admin.Token)

			require.Errorf(t, err, "%s must not exist", namespace)
		})
	}
}

/*
 * Backlog replay.
 */

func TestSocketConnect_BacklogIsReplayedOnConnection(t *testing.T) {
	h := NewHarness(t)

	// Deploying populates the lab's log namespace, which is configured with a backlog ring.
	h.DeployLab(LabAdminID)

	client := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)

	replayed := client.NextBacklog()
	require.NotNil(t, replayed)

	var lines []string
	decodeInto(t, replayed, &lines)

	require.NotEmpty(t, lines, "the deployment output must be replayed to a late subscriber")

	// The first line is the status message's log content, which the instance service writes to the
	// log namespace before handing control to the provider. The provider's own output follows.
	assert.Contains(t, lines[0], "Starting deployment of lab")
	assert.Contains(t, strings.Join(lines, "\n"), InstanceAdminLab,
		"the provider output must be in the backlog too")
}

func TestSocketConnect_NamespacesWithoutABacklogReplayNothing(t *testing.T) {
	h := NewHarness(t)

	// /cmd, /lab-updates, /status-messages and /shell-control are all created with a nil backlog
	// config, so a connecting client must not receive a backlog event.
	for _, namespace := range []string{"/cmd", "/lab-updates", "/status-messages", "/shell-control"} {
		t.Run(namespace, func(t *testing.T) {
			client := h.Dial(namespace, h.Seed.Admin.Token)
			client.ExpectNoBacklog()
		})
	}
}

func TestSocketConnect_BacklogSurvivesReconnection(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	first := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)
	firstReplay := first.NextBacklog()
	first.Close()

	second := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)
	secondReplay := second.NextBacklog()

	assert.Equal(t, toJSON(t, firstReplay), toJSON(t, secondReplay),
		"the backlog is namespace state, so it must not be consumed by the first subscriber")
}

func TestSocketConnect_DestroyingALabReleasesItsLogNamespace(t *testing.T) {
	h := NewHarness(t)

	h.DeployLab(LabAdminID)

	client := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)
	client.NextBacklog()

	h.DestroyLab(LabAdminID)

	// Release clears the listeners and disconnects the subscribers, so a client that connects
	// afterwards gets a fresh namespace with no backlog.
	reconnected := h.Dial("/logs/"+LabAdminID, h.Seed.Admin.Token)
	reconnected.ExpectNoBacklog()
}

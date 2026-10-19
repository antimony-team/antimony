package test

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

// fakeSshNode is an SSH server in place of a node's own one. It accepts any password, so the test can check
// which credentials the shell service logs in with, and records what the session asks for.
type fakeSshNode struct {
	config *gossh.ServerConfig

	mu           sync.Mutex
	username     string
	password     string
	ptyRequested bool
	shellStarted bool
	received     strings.Builder
}

func startFakeSshNode(t *testing.T) *fakeSshNode {
	t.Helper()

	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	hostKey, err := gossh.NewSignerFromKey(privateKey)
	require.NoError(t, err)

	node := &fakeSshNode{}
	node.config = &gossh.ServerConfig{
		PasswordCallback: func(conn gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
			node.mu.Lock()
			defer node.mu.Unlock()

			node.username = conn.User()
			node.password = string(password)
			return &gossh.Permissions{}, nil
		},
	}
	node.config.AddHostKey(hostKey)

	return node
}

// dial is the DialNode of the dummy provider. It serves the SSH server on a loopback connection, net.Pipe doesn't
// work for this, as both ends of an SSH connection write their version before they read.
func (n *fakeSshNode) dial(_ string, _ string, _ int) (net.Conn, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	go func() {
		defer listener.Close()

		conn, err := listener.Accept()
		if err != nil {
			return
		}
		n.serve(conn)
	}()

	return net.Dial("tcp", listener.Addr().String())
}

func (n *fakeSshNode) serve(conn net.Conn) {
	_, channels, requests, err := gossh.NewServerConn(conn, n.config)
	if err != nil {
		return
	}
	go gossh.DiscardRequests(requests)

	for newChannel := range channels {
		if newChannel.ChannelType() != "session" {
			_ = newChannel.Reject(gossh.UnknownChannelType, "only sessions")
			continue
		}

		channel, channelRequests, err := newChannel.Accept()
		if err != nil {
			return
		}
		go n.serveSession(channel, channelRequests)
	}
}

func (n *fakeSshNode) serveSession(channel gossh.Channel, requests <-chan *gossh.Request) {
	go func() {
		buffer := make([]byte, 1024)
		for {
			count, err := channel.Read(buffer)
			n.mu.Lock()
			n.received.Write(buffer[:count])
			n.mu.Unlock()

			if err != nil {
				return
			}
		}
	}()

	for request := range requests {
		n.mu.Lock()
		switch request.Type {
		case "pty-req":
			n.ptyRequested = true
		case "shell":
			n.shellStarted = true
		}
		n.mu.Unlock()

		_ = request.Reply(request.Type == "pty-req" || request.Type == "shell", nil)
	}
}

// fakeSshNodeState is what the node has seen of a session so far.
type fakeSshNodeState struct {
	username     string
	password     string
	ptyRequested bool
	shellStarted bool
}

func (n *fakeSshNode) state() fakeSshNodeState {
	n.mu.Lock()
	defer n.mu.Unlock()

	return fakeSshNodeState{
		username:     n.username,
		password:     n.password,
		ptyRequested: n.ptyRequested,
		shellStarted: n.shellStarted,
	}
}

func (n *fakeSshNode) receivedInput() string {
	n.mu.Lock()
	defer n.mu.Unlock()

	return n.received.String()
}

// A node that runs an SSH server gets a real login shell over SSH, with the credentials of its kind,
// instead of an interactive exec.
func TestOpenShellCommand_ConnectsToTheNodeOverSsh(t *testing.T) {
	h := NewHarness(t)

	node := startFakeSshNode(t)
	h.Provider.DialNodeFn = node.dial
	h.DeployLab(LabAdminID)

	client := h.Dial("/cmd", h.Seed.Admin.Token)
	shellId := openShell(t, client, LabAdminID, NodeSRL)

	call := h.Provider.LastCall("DialNode")
	require.NotNil(t, call)
	assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
	assert.Equal(t, NodeSRL, call.Args["nodeName"])
	assert.Equal(t, 22, call.Args["port"])

	requireEventually(t, func() bool {
		return node.state().shellStarted
	}, "the shell must be started on the node")

	state := node.state()
	assert.Equal(t, "admin", state.username, "the username of the kind's config")
	assert.Equal(t, "NokiaSrl1!", state.password, "the password of the kind's config")
	assert.True(t, state.ptyRequested, "a terminal is needed for an interactive shell")
	assert.False(t, h.Provider.WasCalled("ExecInteractive"), "the exec fallback must not be used")

	dataClient := h.Dial("/shell/"+shellId, h.Seed.Admin.Token)
	requireEventually(t, func() bool {
		dataClient.EmitRawWithoutAck("show version\n")
		return strings.Contains(node.receivedInput(), "show version\n")
	}, "the keystrokes must reach the node over SSH")
}

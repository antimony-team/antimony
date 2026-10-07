package test

import (
	"antimonyBackend/deployment"
	"antimonyBackend/domain/lab"
	"antimonyBackend/sshserver"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

/*
 * The SSH server, against the harness' services and the dummy provider.
 *
 * A node is addressed by the SSH user: "<container-id>", "<lab-id>/<node>", "<instance-name>/<node>" or
 * "<collection>/<lab>/<node>". Without a command, the session is a shell on the node. With a command, it captures
 * the interface the command names. The dummy provider can't capture, so captures end with its error, which still
 * shows which node and interface the server asked for.
 */

// sshTestServer is an SSH server running against a harness.
type sshTestServer struct {
	h      *Harness
	addr   string
	server *sshserver.Server
}

// startSSHServer runs the SSH server against the harness' services on a free local port.
func startSSHServer(t *testing.T, h *Harness) *sshTestServer {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	require.NoError(t, listener.Close())

	cfg := *h.Config
	cfg.SSH.SSHPort = listener.Addr().(*net.TCPAddr).Port

	server := sshserver.Create(&cfg, h.ShellService, h.InstanceService, h.Provider)
	go func() { _ = server.Start() }()
	t.Cleanup(server.Close)

	requireEventually(t, func() bool {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err != nil {
			return false
		}
		_ = conn.Close()
		return true
	}, "the SSH server must start listening")

	return &sshTestServer{h: h, addr: addr, server: server}
}

func (s *sshTestServer) dial(t *testing.T, user string) *gossh.Client {
	t.Helper()

	client, err := gossh.Dial("tcp", s.addr, &gossh.ClientConfig{
		User:            user,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(), //nolint:gosec // a throwaway test server
		Timeout:         5 * time.Second,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	return client
}

type sshResult struct {
	stdout   string
	stderr   string
	exitCode int
}

// run runs command as user without a terminal, or requests a shell when command is empty.
func (s *sshTestServer) run(t *testing.T, user string, command string) sshResult {
	t.Helper()

	session, err := s.dial(t, user).NewSession()
	require.NoError(t, err)
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	done := make(chan error, 1)
	go func() {
		if command == "" {
			if err := session.Shell(); err != nil {
				done <- err
				return
			}
			done <- session.Wait()
			return
		}
		done <- session.Run(command)
	}()

	select {
	case err = <-done:
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the session did not end", "user %q, command %q", user, command)
	}

	exitCode := 0
	var exitErr *gossh.ExitError
	if errors.As(err, &exitErr) {
		exitCode = exitErr.ExitStatus()
	} else {
		require.NoError(t, err)
	}

	return sshResult{stdout: stdout.String(), stderr: stderr.String(), exitCode: exitCode}
}

// lockedBuffer is a bytes.Buffer that the SSH client can write to while the test reads it.
type lockedBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// sshShell is an interactive shell session with a terminal.
type sshShell struct {
	session *gossh.Session
	stdin   io.WriteCloser
	stdout  *lockedBuffer
	done    chan error
}

// openShell opens a shell as user in a terminal of the given size, like an interactive ssh client does.
func (s *sshTestServer) openShell(t *testing.T, user string, cols int, rows int) *sshShell {
	t.Helper()

	session, err := s.dial(t, user).NewSession()
	require.NoError(t, err)

	stdin, err := session.StdinPipe()
	require.NoError(t, err)

	stdout := &lockedBuffer{}
	session.Stdout = stdout
	session.Stderr = stdout

	require.NoError(t, session.RequestPty("xterm", rows, cols, gossh.TerminalModes{}))
	require.NoError(t, session.Shell())

	shell := &sshShell{session: session, stdin: stdin, stdout: stdout, done: make(chan error, 1)}
	go func() { shell.done <- session.Wait() }()

	return shell
}

// nodeShell waits for the shell the server opened on the lab's host node and returns it.
func nodeShell(t *testing.T, h *Harness, instanceName string) *deployment.DummyShellSession {
	t.Helper()

	var shell *deployment.DummyShellSession
	requireEventually(t, func() bool {
		shell = h.Provider.Shell(instanceName, NodeHost)
		return shell != nil
	}, "the server must open a shell on the node")

	return shell
}

// createLabWithUuid creates and deploys a lab through the API, which gives it a real UUID unlike the seeded labs.
func createLabWithUuid(t *testing.T, h *Harness) lab.Lab {
	t.Helper()

	start := time.Now().Add(-time.Minute)

	var labId string
	h.POST("/labs", lab.LabIn{
		Name:       ptr("SSH Lab"),
		StartTime:  &start,
		TopologyId: ptr(TopologyAdminID),
	}, h.Seed.Admin.Token).RequireOk(&labId)

	h.DeployLab(labId)

	created, err := h.LabRepo.GetByUuid(t.Context(), labId)
	require.NoError(t, err)

	return *created
}

/*
 * Addressing a node
 */

func TestSSH_AddressesANodeByEveryUserForm(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	containerId := h.Provider.Node(InstanceAdminLab, NodeHost).ContainerId

	cases := map[string]string{
		"container id":             containerId,
		"instance and node":        InstanceAdminLab + "/" + NodeHost,
		"collection, lab and node": CollectionPublicBoth + "/Admin Lab/" + NodeHost,
	}

	for name, user := range cases {
		t.Run(name, func(t *testing.T) {
			before := h.Provider.CallCount("ExecInteractive")

			shell := server.openShell(t, user, 80, 24)
			defer shell.session.Close()

			requireEventually(t, func() bool {
				return h.Provider.CallCount("ExecInteractive") == before+1
			}, "the server must open a shell on the node")

			call := h.Provider.LastCall("ExecInteractive")
			require.NotNil(t, call)
			assert.Equal(t, InstanceAdminLab, call.Args["instanceName"])
			assert.Equal(t, NodeHost, call.Args["nodeName"])
		})
	}
}

func TestSSH_AddressesANodeByLabIdAndNode(t *testing.T) {
	h := NewHarness(t)
	createdLab := createLabWithUuid(t, h)
	server := startSSHServer(t, h)

	shell := server.openShell(t, createdLab.UUID+"/"+NodeHost, 80, 24)
	defer shell.session.Close()

	nodeShell(t, h, createdLab.InstanceName)

	call := h.Provider.LastCall("ExecInteractive")
	require.NotNil(t, call)
	assert.Equal(t, createdLab.InstanceName, call.Args["instanceName"])
}

func TestSSH_RejectsUsersWithTooManyParts(t *testing.T) {
	h := NewHarness(t)
	server := startSSHServer(t, h)

	result := server.run(t, "a/b/c/d", "eth1")

	assert.Equal(t, 2, result.exitCode)
	assert.Contains(t, result.stderr, "expected")
}

func TestSSH_ReportsNodesItCannotFind(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	cases := map[string]string{
		"unknown container id": "no-such-container",
		"unknown node":         InstanceAdminLab + "/missing",
		"unknown lab id":       "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f/" + NodeHost,
		"unknown lab name":     CollectionPublicBoth + "/Missing Lab/" + NodeHost,
		"unknown collection":   "no-such-collection/Admin Lab/" + NodeHost,
	}

	for name, user := range cases {
		t.Run(name, func(t *testing.T) {
			result := server.run(t, user, "eth1")

			assert.Equal(t, 1, result.exitCode)
			assert.Contains(t, result.stderr, "unable to connect to node")
		})
	}

	assert.Zero(t, h.Provider.CallCount("OpenCapture"))
	assert.Zero(t, h.Provider.CallCount("ExecInteractive"))
}

func TestSSH_ReportsALabThatIsNotDeployed(t *testing.T) {
	h := NewHarness(t)
	server := startSSHServer(t, h)

	result := server.run(t, CollectionPublicBoth+"/Admin Lab/"+NodeHost, "eth1")

	assert.Equal(t, 1, result.exitCode)
	assert.Contains(t, result.stderr, "lab is not running")
}

/*
 * Shells
 */

func TestSSH_ShellRequiresATerminal(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	result := server.run(t, InstanceAdminLab+"/"+NodeHost, "")

	assert.Equal(t, 2, result.exitCode)
	assert.Contains(t, result.stderr, "a terminal is required")
	assert.Zero(t, h.Provider.CallCount("ExecInteractive"), "no shell may be opened without a terminal")
}

func TestSSH_ShellRelaysInputAndOutput(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	shell := server.openShell(t, InstanceAdminLab+"/"+NodeHost, 80, 24)
	defer shell.session.Close()

	node := nodeShell(t, h, InstanceAdminLab)

	node.Push("hello from the node\r\n")
	requireEventually(t, func() bool {
		return strings.Contains(shell.stdout.String(), "hello from the node")
	}, "node output must reach the client")

	_, err := shell.stdin.Write([]byte("show version\n"))
	require.NoError(t, err)
	requireEventually(t, func() bool {
		return strings.Contains(node.Written(), "show version")
	}, "client input must reach the node")
}

func TestSSH_ShellFollowsTheTerminalSize(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	shell := server.openShell(t, InstanceAdminLab+"/"+NodeHost, 120, 40)
	defer shell.session.Close()

	node := nodeShell(t, h, InstanceAdminLab)

	// The client's initial size arrives as an explicit resize and again as the first window change, so only the
	// sizes are checked, not how often they were applied.
	requireEventually(t, func() bool {
		resizes := node.Resizes()
		return len(resizes) > 0 && resizes[0] == [2]uint{120, 40}
	}, "the node's terminal must start at the client's size")

	require.NoError(t, shell.session.WindowChange(50, 200))
	requireEventually(t, func() bool {
		resizes := node.Resizes()
		return resizes[len(resizes)-1] == [2]uint{200, 50}
	}, "a resized client terminal must resize the node's terminal")
}

func TestSSH_DisconnectingClosesTheNodeShell(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	client := server.dial(t, InstanceAdminLab+"/"+NodeHost)
	session, err := client.NewSession()
	require.NoError(t, err)
	require.NoError(t, session.RequestPty("xterm", 24, 80, gossh.TerminalModes{}))
	require.NoError(t, session.Shell())

	node := nodeShell(t, h, InstanceAdminLab)

	require.NoError(t, client.Close())

	requireEventually(t, node.IsClosed, "the node's shell must be closed when the client disconnects")
}

func TestSSH_ClosingTheSessionClosesTheNodeShellOnASharedConnection(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	// OpenSSH's connection sharing (ControlMaster) runs several sessions over one connection and keeps it open when
	// a session ends.
	client := server.dial(t, InstanceAdminLab+"/"+NodeHost)
	session, err := client.NewSession()
	require.NoError(t, err)
	require.NoError(t, session.RequestPty("xterm", 24, 80, gossh.TerminalModes{}))
	require.NoError(t, session.Shell())

	node := nodeShell(t, h, InstanceAdminLab)

	// The server closes its end in response, so the client's close may report EOF
	_ = session.Close()

	requireEventually(t, node.IsClosed, "the node's shell must be closed when its session ends")

	// The connection itself stays usable for further sessions.
	second, err := client.NewSession()
	require.NoError(t, err)
	_ = second.Close()
}

func TestSSH_TheShellExitingEndsTheSession(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	shell := server.openShell(t, InstanceAdminLab+"/"+NodeHost, 80, 24)
	node := nodeShell(t, h, InstanceAdminLab)

	require.NoError(t, node.Close())

	select {
	case err := <-shell.done:
		require.NoError(t, err, "a shell that exits on its own ends the session with exit status 0")
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the session did not end when the node's shell exited")
	}
}

func TestSSH_ClosingTheServerEndsShells(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	shell := server.openShell(t, InstanceAdminLab+"/"+NodeHost, 80, 24)
	node := nodeShell(t, h, InstanceAdminLab)

	server.server.Close()

	requireEventually(t, node.IsClosed, "closing the server must close the node's shell")

	select {
	case <-shell.done:
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the session did not end when the server was closed")
	}
}

/*
 * Captures
 */

func TestSSH_CaptureCommandsSelectTheInterface(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	cases := map[string]struct {
		command  string
		expected string
	}{
		"bare interface":            {"eth1", "eth1"},
		"wireshark sshdump command": {"tcpdump -U -i e1-1 -w -", "e1-1"},
		"sshdump through sudo":      {"sudo tcpdump -U -i e1-2 -w -", "e1-2"},
		"grouped tcpdump flags":     {"/usr/sbin/tcpdump -nUi eth2 -w -", "eth2"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			result := server.run(t, InstanceAdminLab+"/"+NodeHost, c.command)

			// The dummy provider can't capture, so the capture fails after the server asked for it.
			assert.Equal(t, 1, result.exitCode)
			assert.Contains(t, result.stderr, "failed to capture "+c.expected)

			call := h.Provider.LastCall("OpenCapture")
			require.NotNil(t, call)
			assert.Equal(t, map[string]any{
				"instanceName":  InstanceAdminLab,
				"nodeName":      NodeHost,
				"interfaceName": c.expected,
			}, call.Args)
		})
	}
}

func TestSSH_RejectsCaptureCommandsWithoutASingleInterface(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	for _, command := range []string{"tcpdump -U -w -", "eth0 eth1"} {
		t.Run(command, func(t *testing.T) {
			result := server.run(t, InstanceAdminLab+"/"+NodeHost, command)

			assert.Equal(t, 2, result.exitCode)
		})
	}

	assert.Zero(t, h.Provider.CallCount("OpenCapture"))
}

func TestSSH_RejectsCapturesOnAStoppedNode(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	h.Dial("/cmd", h.Seed.Admin.Token).Emit(nodeCommand(cmdStopNode, LabAdminID, NodeHost)).RequireOk(nil)
	requireEventually(t, func() bool {
		return nodeState(t, h, LabAdminID, NodeHost) == deployment.NodeStates.Stopped
	}, "the node must stop")

	result := server.run(t, InstanceAdminLab+"/"+NodeHost, "eth1")

	assert.Equal(t, 1, result.exitCode)
	assert.Contains(t, result.stderr, "is not running")
	assert.Zero(t, h.Provider.CallCount("OpenCapture"))
}

/*
 * Capture streams, with a fake capture source the test feeds with packets
 */

// fakeCaptureSource is a capture source whose packets the test sends.
type fakeCaptureSource struct {
	packets   chan []byte
	closed    chan struct{}
	closeOnce sync.Once
}

func newFakeCaptureSource() *fakeCaptureSource {
	return &fakeCaptureSource{packets: make(chan []byte, 16), closed: make(chan struct{})}
}

func (f *fakeCaptureSource) ReadPacketData() ([]byte, gopacket.CaptureInfo, error) {
	select {
	case data := <-f.packets:
		return data, gopacket.CaptureInfo{Timestamp: time.Now(), CaptureLength: len(data), Length: len(data)}, nil
	case <-f.closed:
		return nil, gopacket.CaptureInfo{}, io.EOF
	}
}

func (f *fakeCaptureSource) Close() {
	f.closeOnce.Do(func() { close(f.closed) })
}

func (f *fakeCaptureSource) IsClosed() bool {
	select {
	case <-f.closed:
		return true
	default:
		return false
	}
}

// capturePacket is an Ethernet frame for the fake sources to send.
var capturePacket = append(
	[]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02, 0x42, 0xac, 0x14, 0x00, 0x02, 0x08, 0x06},
	bytes.Repeat([]byte{0xab}, 46)...,
)

// captureClient is a running capture session, reading the pcap stream like Wireshark does.
type captureClient struct {
	client  *gossh.Client
	session *gossh.Session
	stdout  io.Reader
	stderr  *lockedBuffer
	done    chan error

	// reader is set once the pcap header has arrived. header delivers it, the read is only started once.
	reader     *pcapgo.Reader
	header     chan *pcapgo.Reader
	headerOnce sync.Once
}

// startCaptureClient starts a capture session on a connection of its own, without waiting for the capture to open.
func (s *sshTestServer) startCaptureClient(t *testing.T, command string) *captureClient {
	t.Helper()

	return startCaptureSession(t, s.dial(t, InstanceAdminLab+"/"+NodeHost), command, nil)
}

// startCaptureSession starts a capture session on an existing connection, with the given input, if any.
func startCaptureSession(t *testing.T, client *gossh.Client, command string, stdin io.Reader) *captureClient {
	t.Helper()

	session, err := client.NewSession()
	require.NoError(t, err)
	session.Stdin = stdin

	stdout, err := session.StdoutPipe()
	require.NoError(t, err)
	stderr := &lockedBuffer{}
	session.Stderr = stderr

	require.NoError(t, session.Start(command))

	capture := &captureClient{
		client:  client,
		session: session,
		stdout:  stdout,
		stderr:  stderr,
		done:    make(chan error, 1),
	}
	go func() { capture.done <- session.Wait() }()

	return capture
}

// waitForHeader waits until the server has sent the pcap header, which it does once the capture is open. It can be
// called again after a timeout, it keeps waiting for the same header.
func (c *captureClient) waitForHeader(t *testing.T, timeout time.Duration) bool {
	t.Helper()

	if c.reader != nil {
		return true
	}

	c.headerOnce.Do(func() {
		c.header = make(chan *pcapgo.Reader, 1)
		go func() {
			reader, err := pcapgo.NewReader(c.stdout)
			if err == nil {
				c.header <- reader
			}
		}()
	})

	select {
	case c.reader = <-c.header:
		return true
	case <-time.After(timeout):
		return false
	}
}

// requirePacket waits for the next packet of the capture and checks its content.
func (c *captureClient) requirePacket(t *testing.T, expected []byte) {
	t.Helper()

	result := make(chan []byte, 1)
	go func() {
		data, _, err := c.reader.ReadPacketData()
		if err == nil {
			result <- data
		}
	}()

	select {
	case data := <-result:
		assert.Equal(t, expected, data)
	case <-time.After(5 * time.Second):
		require.FailNow(t, "no packet arrived")
	}
}

// requireEnded waits for the capture session to end and returns its exit code.
func (c *captureClient) requireEnded(t *testing.T) int {
	t.Helper()

	select {
	case err := <-c.done:
		var exitErr *gossh.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitStatus()
		}
		require.NoError(t, err)
		return 0
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the capture session did not end")
		return -1
	}
}

// countingCaptures makes every capture open the given source and counts the openings per interface.
func countingCaptures(h *Harness, source func(interfaceName string) *fakeCaptureSource) func(string) int {
	var mu sync.Mutex
	openings := map[string]int{}

	h.Provider.SetOpenCaptureFn(func(_ context.Context, _, _, interfaceName string) (deployment.CaptureSource, error) {
		mu.Lock()
		openings[interfaceName]++
		mu.Unlock()

		return source(interfaceName), nil
	})

	return func(interfaceName string) int {
		mu.Lock()
		defer mu.Unlock()
		return openings[interfaceName]
	}
}

func TestSSH_CaptureStreamsPacketsAsPcap(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	countingCaptures(h, func(string) *fakeCaptureSource { return source })

	capture := server.startCaptureClient(t, "tcpdump -U -i eth1 -w -")
	defer capture.client.Close()

	require.True(t, capture.waitForHeader(t, 5*time.Second), "the pcap header must arrive")
	assert.Equal(t, layers.LinkTypeEthernet, capture.reader.LinkType())

	source.packets <- capturePacket
	capture.requirePacket(t, capturePacket)
}

func TestSSH_SessionsOnTheSameInterfaceShareOneCapture(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	openings := countingCaptures(h, func(string) *fakeCaptureSource { return source })

	first := server.startCaptureClient(t, "eth1")
	defer first.client.Close()
	require.True(t, first.waitForHeader(t, 5*time.Second))

	second := server.startCaptureClient(t, "eth1")
	defer second.client.Close()
	require.True(t, second.waitForHeader(t, 5*time.Second))

	assert.Equal(t, 1, openings("eth1"), "the interface must only be captured once")

	source.packets <- capturePacket
	first.requirePacket(t, capturePacket)
	second.requirePacket(t, capturePacket)
}

func TestSSH_CaptureStopsWhenTheLastSessionLeaves(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	countingCaptures(h, func(string) *fakeCaptureSource { return source })

	first := server.startCaptureClient(t, "eth1")
	require.True(t, first.waitForHeader(t, 5*time.Second))
	second := server.startCaptureClient(t, "eth1")
	require.True(t, second.waitForHeader(t, 5*time.Second))

	require.NoError(t, first.client.Close())
	<-first.done
	time.Sleep(100 * time.Millisecond)
	assert.False(t, source.IsClosed(), "the capture must keep running while a session still watches it")

	require.NoError(t, second.client.Close())
	requireEventually(t, source.IsClosed, "the capture must stop when its last session leaves")
}

func TestSSH_ClosingACaptureSessionStopsItOnASharedConnection(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	countingCaptures(h, func(string) *fakeCaptureSource { return source })

	// Clients like sshdump or ssh with ControlMaster keep the connection open after a session is closed
	client := server.dial(t, InstanceAdminLab+"/"+NodeHost)
	capture := startCaptureSession(t, client, "eth1", nil)
	require.True(t, capture.waitForHeader(t, 5*time.Second))

	_ = capture.session.Close()
	requireEventually(t, source.IsClosed, "closing the session must stop the capture while the connection stays open")

	second, err := client.NewSession()
	require.NoError(t, err, "the connection must stay usable")
	_ = second.Close()
}

func TestSSH_ACaptureWithoutInputKeepsRunning(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	countingCaptures(h, func(string) *fakeCaptureSource { return source })

	// Like ssh -n, the client ends its input right away, but keeps watching the capture
	client := server.dial(t, InstanceAdminLab+"/"+NodeHost)
	capture := startCaptureSession(t, client, "eth1", strings.NewReader(""))
	require.True(t, capture.waitForHeader(t, 5*time.Second))

	time.Sleep(200 * time.Millisecond)
	assert.False(t, source.IsClosed(), "the end of the input must not stop the capture")

	source.packets <- capturePacket
	capture.requirePacket(t, capturePacket)
}

func TestSSH_ASlowOpeningDoesNotBlockOtherCaptures(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	opening := make(chan struct{})
	release := make(chan struct{})
	releaseOnce := sync.OnceFunc(func() { close(release) })
	// Released on every exit, so a failing test doesn't leave the opening blocking the server's shutdown
	t.Cleanup(releaseOnce)
	slowSource := newFakeCaptureSource()

	var mu sync.Mutex
	openings := map[string]int{}
	h.Provider.SetOpenCaptureFn(func(_ context.Context, _, _, interfaceName string) (deployment.CaptureSource, error) {
		mu.Lock()
		openings[interfaceName]++
		mu.Unlock()

		if interfaceName == "eth1" {
			close(opening)
			<-release
			return slowSource, nil
		}
		return newFakeCaptureSource(), nil
	})

	slow := server.startCaptureClient(t, "eth1")
	defer slow.client.Close()
	<-opening

	// Another interface opens right away, although eth1 is still opening
	other := server.startCaptureClient(t, "eth2")
	defer other.client.Close()
	require.True(t, other.waitForHeader(t, 2*time.Second), "a slow opening must not block captures of other interfaces")

	// A second session on eth1 joins the opening instead of starting another one
	joining := server.startCaptureClient(t, "eth1")
	defer joining.client.Close()
	assert.False(t, joining.waitForHeader(t, 200*time.Millisecond), "the joining session must wait for the opening")

	releaseOnce()
	require.True(t, slow.waitForHeader(t, 5*time.Second))
	require.True(t, joining.waitForHeader(t, 5*time.Second))

	mu.Lock()
	assert.Equal(t, 1, openings["eth1"], "eth1 must only be opened once")
	mu.Unlock()

	slowSource.packets <- capturePacket
	slow.requirePacket(t, capturePacket)
	joining.requirePacket(t, capturePacket)
}

func TestSSH_LeavingDuringTheOpeningCancelsIt(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	opening := make(chan struct{})
	canceled := make(chan struct{})
	h.Provider.SetOpenCaptureFn(func(ctx context.Context, _, _, _ string) (deployment.CaptureSource, error) {
		close(opening)
		<-ctx.Done()
		close(canceled)
		return nil, ctx.Err()
	})

	capture := server.startCaptureClient(t, "eth1")
	<-opening

	require.NoError(t, capture.client.Close())

	select {
	case <-canceled:
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the opening must be canceled when its only session leaves")
	}
}

func TestSSH_AFailedOpeningIsReportedToEveryWaitingSession(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	release := make(chan struct{})
	var mu sync.Mutex
	attempts := 0
	h.Provider.SetOpenCaptureFn(func(_ context.Context, _, _, _ string) (deployment.CaptureSource, error) {
		mu.Lock()
		attempts++
		mu.Unlock()

		<-release
		return nil, errors.New("interface does not exist")
	})

	first := server.startCaptureClient(t, "eth9")
	defer first.client.Close()
	second := server.startCaptureClient(t, "eth9")
	defer second.client.Close()

	// Both sessions wait for the same opening
	time.Sleep(100 * time.Millisecond)
	close(release)

	for _, capture := range []*captureClient{first, second} {
		assert.Equal(t, 1, capture.requireEnded(t))
		assert.Contains(t, capture.stderr.String(), "interface does not exist")
	}

	// The failed capture is forgotten, the next session tries again
	retry := server.startCaptureClient(t, "eth9")
	defer retry.client.Close()
	assert.Equal(t, 1, retry.requireEnded(t))

	mu.Lock()
	assert.Equal(t, 2, attempts)
	mu.Unlock()
}

func TestSSH_ACaptureEndingEndsItsSessions(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	countingCaptures(h, func(string) *fakeCaptureSource { return source })

	capture := server.startCaptureClient(t, "eth1")
	defer capture.client.Close()
	require.True(t, capture.waitForHeader(t, 5*time.Second))

	// The node stopped, so its capture ends
	source.Close()

	assert.Equal(t, 0, capture.requireEnded(t))
}

func TestSSH_ClosingTheServerEndsCaptures(t *testing.T) {
	h := NewHarness(t)
	h.DeployLab(LabAdminID)
	server := startSSHServer(t, h)

	source := newFakeCaptureSource()
	countingCaptures(h, func(string) *fakeCaptureSource { return source })

	capture := server.startCaptureClient(t, "eth1")
	defer capture.client.Close()
	require.True(t, capture.waitForHeader(t, 5*time.Second))

	server.server.Close()

	requireEventually(t, source.IsClosed, "closing the server must stop the capture")
	select {
	case <-capture.done:
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the capture session did not end when the server was closed")
	}
}

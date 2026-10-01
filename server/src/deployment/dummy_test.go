package deployment

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * The optional behaviour the server enables on the dummy provider (see CreateProvider). The default,
 * instant and silent behaviour is covered by the Go test suite in antimonyBackend/test.
 */

const dummyTopology = `name: dummy
topology:
  nodes:
    host1:
      kind: linux
      image: alpine
`

func writeDummyTopology(t *testing.T) string {
	t.Helper()

	topologyFile := filepath.Join(t.TempDir(), "topology.clab.yaml")
	require.NoError(t, os.WriteFile(topologyFile, []byte(dummyTopology), 0o600))

	return topologyFile
}

// readUntil reads from the session until the output contains expected, and returns the output.
func readUntil(t *testing.T, session ShellExecSession, expected string) string {
	t.Helper()

	output := make(chan string, 1)

	go func() {
		var received strings.Builder

		buffer := make([]byte, 256)
		for !strings.Contains(received.String(), expected) {
			n, err := session.Read(buffer)
			if err != nil {
				break
			}
			received.Write(buffer[:n])
		}

		output <- received.String()
	}()

	select {
	case received := <-output:
		require.Contains(t, received, expected)
		return received
	case <-time.After(2 * time.Second):
		require.FailNowf(t, "timed out", "expected the shell to print %q", expected)
		return ""
	}
}

// logCollector records the lines a node writes to its log stream.
type logCollector struct {
	mu    sync.Mutex
	lines []string
}

func (c *logCollector) log(line string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.lines = append(c.lines, line)
}

func (c *logCollector) all() []string {
	c.mu.Lock()
	defer c.mu.Unlock()

	return append([]string{}, c.lines...)
}

func TestDummyProvider_DeployTakesTheConfiguredDelay(t *testing.T) {
	provider := CreateDummyProvider()
	provider.DeployDelay = 100 * time.Millisecond

	started := time.Now()
	require.NoError(t, provider.Deploy(context.Background(), writeDummyTopology(t), "lab", nil))

	assert.GreaterOrEqual(t, time.Since(started), provider.DeployDelay)
	assert.True(t, provider.HasInstance("lab"))
}

func TestDummyProvider_DelayedDeployCanBeCanceled(t *testing.T) {
	provider := CreateDummyProvider()
	provider.DeployDelay = time.Minute

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	err := provider.Deploy(ctx, writeDummyTopology(t), "lab", nil)

	require.ErrorIs(t, err, context.Canceled)
	assert.False(t, provider.HasInstance("lab"), "a canceled deployment must not leave an instance behind")
}

func TestDummyProvider_EchoShellsPrintAPromptAndEchoInput(t *testing.T) {
	provider := CreateDummyProvider()
	provider.EchoShells = true

	session, err := provider.ExecInteractive(context.Background(), "lab", "host1", []string{"sh"})
	require.NoError(t, err)
	defer session.Close()

	readUntil(t, session, "host1:~$ ")

	_, err = session.Write([]byte("lss\x7f\r"))
	require.NoError(t, err)

	// Backspace erases the extra "s", Enter starts a new prompt line.
	output := readUntil(t, session, "\r\nhost1:~$ ")
	assert.Equal(t, "lss\b \b\r\nhost1:~$ ", output)
}

func TestDummyProvider_ShellsDoNotEchoByDefault(t *testing.T) {
	provider := CreateDummyProvider()

	session, err := provider.ExecInteractive(context.Background(), "lab", "host1", []string{"sh"})
	require.NoError(t, err)

	_, err = session.Write([]byte("ls\r"))
	require.NoError(t, err)

	assert.Empty(t, session.(*DummyShellSession).out,
		"the Go test suite pushes shell output itself, so the dummy must stay silent")
}

func TestDummyProvider_EmitContainerLogsReportsTheNodeLifecycle(t *testing.T) {
	provider := CreateDummyProvider()
	provider.EmitContainerLogs = true

	ctx := context.Background()
	require.NoError(t, provider.Deploy(ctx, writeDummyTopology(t), "lab", nil))

	var logs logCollector
	require.NoError(t, provider.StreamContainerLogs(ctx, "lab", "host1", logs.log))

	require.NoError(t, provider.StopNode(ctx, "lab", "host1"))
	require.NoError(t, provider.StartNode(ctx, "lab", "host1"))
	require.NoError(t, provider.RestartNode(ctx, "lab", "host1"))

	assert.Equal(t, []string{
		"[dummy] host1: container is starting",
		"[dummy] host1: container is ready",
		"[dummy] host1: container stopped",
		"[dummy] host1: container started",
		"[dummy] host1: container restarted",
	}, logs.all())
}

func TestDummyProvider_NodesWriteNoLogsByDefault(t *testing.T) {
	provider := CreateDummyProvider()

	ctx := context.Background()
	require.NoError(t, provider.Deploy(ctx, writeDummyTopology(t), "lab", nil))

	var logs logCollector
	require.NoError(t, provider.StreamContainerLogs(ctx, "lab", "host1", logs.log))
	require.NoError(t, provider.StopNode(ctx, "lab", "host1"))

	assert.Empty(t, logs.all())
}

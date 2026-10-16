//go:build e2e

package deployment

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony-server/utils"
)

/*
 * Provider e2e tests.
 *
 * One suite runs against a real provider: containerlab on the local Docker host, or clabernetes in
 * the cluster of the current kubeconfig. It deploys a lab of two linked alpine nodes and walks
 * through every provider method, so the subtests run in order and share the lab.
 *
 * Run them with "task test-e2e-containerlab" or "task test-e2e-clabernetes". ANTIMONY_E2E_PROVIDER
 * selects the provider. Containerlab needs root, since capturing, reading a node's interfaces and
 * its stats enter the node's namespaces.
 */

const (
	e2eProviderEnv = "ANTIMONY_E2E_PROVIDER"
	e2eImageEnv    = "ANTIMONY_E2E_IMAGE"
	// e2eKeepFailedEnv keeps the lab of a failed run, so CI can show what it looked like
	e2eKeepFailedEnv = "ANTIMONY_E2E_KEEP_FAILED"

	// e2eLogMarker is what the nodes print when they start, the log stream has to deliver it
	e2eLogMarker = "antimony-e2e-started"

	e2eHost1Address = "10.99.0.1"
	e2eHost2Address = "10.99.0.2"
	e2eDialPort     = 4567
)

const e2eTopologyTemplate = `name: %[1]s
topology:
  nodes:
    host1:
      kind: linux
      image: %[2]s
      cmd: sh -c "echo %[3]s; exec sleep infinity"
      labels:
        graph-posX: -120.5
    host2:
      kind: linux
      image: %[2]s
      cmd: sh -c "echo %[3]s; exec sleep infinity"
  links:
    - endpoints: ["host1:eth1", "host2:eth1"]
`

type e2eLab struct {
	provider     DeploymentProvider
	providerName string

	name         string
	topologyFile string

	// deployTimeout bounds a deployment, clabernetes has to schedule pods and pull into them
	deployTimeout time.Duration

	// keep leaves the lab deployed after the test
	keep bool
}

func TestProviderE2E(t *testing.T) {
	lab := newE2ELab(t)

	if !t.Run("Deploy", lab.testDeploy) {
		lab.keep = os.Getenv(e2eKeepFailedEnv) != ""
		t.Fatal("the lab didn't deploy, the other tests need it")
	}

	t.Run("Inspect", lab.testInspect)
	t.Run("Exec", lab.testExec)
	t.Run("NetworkInterfaces", lab.testNetworkInterfaces)
	t.Run("LinkBetweenNodes", lab.testLinkBetweenNodes)
	t.Run("DialNode", lab.testDialNode)
	t.Run("ExecInteractive", lab.testExecInteractive)
	t.Run("ReadNodeStats", lab.testReadNodeStats)
	t.Run("OpenCapture", lab.testOpenCapture)
	t.Run("StreamContainerLogs", lab.testStreamContainerLogs)
	t.Run("NodeLifecycle", lab.testNodeLifecycle)
	t.Run("Redeploy", lab.testRedeploy)
	t.Run("MissingNodeContainer", lab.testMissingNodeContainer)

	if t.Failed() && os.Getenv(e2eKeepFailedEnv) != "" {
		lab.keep = true
		t.Logf("keeping lab %s for inspection", lab.name)
		return
	}

	t.Run("Destroy", lab.testDestroy)
}

func newE2ELab(t *testing.T) *e2eLab {
	t.Helper()

	lab := &e2eLab{name: "e2e-" + randomSuffix(t), providerName: os.Getenv(e2eProviderEnv)}

	switch lab.providerName {
	case "containerlab":
		if os.Geteuid() != 0 {
			t.Fatal("the containerlab e2e tests need root, run them with task test-e2e-containerlab")
		}
		lab.provider = CreateContainerlabProvider()
		lab.deployTimeout = 3 * time.Minute
	case "clabernetes":
		lab.provider = CreateClabernetesProvider()
		lab.deployTimeout = 10 * time.Minute
	default:
		t.Skipf("%s is %q, set it to containerlab or clabernetes", e2eProviderEnv, lab.providerName)
	}

	image := os.Getenv(e2eImageEnv)
	if image == "" {
		image = "alpine:latest"
	}

	// Containerlab puts the lab directory next to the topology file
	lab.topologyFile = filepath.Join(t.TempDir(), "topology.clab.yaml")
	topology := fmt.Sprintf(e2eTopologyTemplate, lab.name, image, e2eLogMarker)
	require.NoError(t, os.WriteFile(lab.topologyFile, []byte(topology), 0o600))

	t.Cleanup(func() {
		if lab.keep {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()

		if err := lab.provider.Destroy(ctx, lab.topologyFile, lab.name, nil); err != nil {
			t.Logf("cleaning up lab %s failed: %v", lab.name, err)
		}
	})

	return lab
}

func (l *e2eLab) testDeploy(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), l.deployTimeout)
	defer cancel()

	logs := &logCollector{}
	err := l.provider.Deploy(ctx, l.topologyFile, l.name, logs.log)
	for _, line := range logs.all() {
		t.Log(line)
	}
	require.NoError(t, err)

	assert.NotEmpty(t, logs.all(), "the deployment should report its progress")

	// The nodes may still be starting once the deployment returns
	l.waitForNodeState(t, "host1", NodeStates.Running)
	l.waitForNodeState(t, "host2", NodeStates.Running)
}

func (l *e2eLab) testInspect(t *testing.T) {
	ctx := t.Context()

	labs, err := l.provider.InspectLabs(ctx, nil)
	require.NoError(t, err)
	require.Contains(t, labs, l.name)
	assert.ElementsMatch(t, []string{"host1", "host2"}, nodeNames(labs[l.name]))

	nodes, err := l.provider.InspectLab(ctx, l.topologyFile, l.name, nil)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"host1", "host2"}, nodeNames(nodes))

	for _, node := range nodes {
		assert.Equal(t, l.name, node.LabName, "node %s", node.Name)
		assert.Equal(t, NodeStates.Running, node.State, "node %s", node.Name)
		assert.NotEmpty(t, node.ContainerId, "node %s", node.Name)
		assert.NotEmpty(t, node.ContainerName, "node %s", node.Name)
		assert.Contains(t, node.Image, "alpine", "node %s", node.Name)
		// Every provider reports bare addresses, without a prefix length
		_, err := netip.ParseAddr(node.IPv4Address)
		require.NoError(t, err, "node %s has no valid IPv4 address", node.Name)
		if node.IPv6Address != "" {
			_, err := netip.ParseAddr(node.IPv6Address)
			require.NoError(t, err, "node %s has no valid IPv6 address", node.Name)
		}
	}

	host1, err := l.provider.InspectNode(ctx, l.topologyFile, l.name, "host1", nil)
	require.NoError(t, err)
	assert.Equal(t, "host1", host1.Name)
	assert.Equal(t, NodeStates.Running, host1.State)

	t.Run("an unknown node is not found", func(t *testing.T) {
		_, err := l.provider.InspectNode(ctx, l.topologyFile, l.name, "missing", nil)
		assert.ErrorIs(t, err, utils.ErrNodeNotFound)
	})

	t.Run("a lab that isn't deployed is not running", func(t *testing.T) {
		missing := "e2e-missing-" + randomSuffix(t)
		file := filepath.Join(t.TempDir(), "topology.clab.yaml")
		topology := fmt.Sprintf(e2eTopologyTemplate, missing, "alpine:latest", e2eLogMarker)
		require.NoError(t, os.WriteFile(file, []byte(topology), 0o600))

		_, err := l.provider.InspectLab(ctx, file, missing, nil)
		require.ErrorIs(t, err, utils.ErrLabNotRunning)

		labs, err := l.provider.InspectLabs(ctx, nil)
		require.NoError(t, err)
		assert.NotContains(t, labs, missing)
	})
}

func (l *e2eLab) testExec(t *testing.T) {
	ctx := t.Context()

	t.Run("returns the output and a zero exit code", func(t *testing.T) {
		out, code, err := l.provider.Exec(ctx, l.name, "host1", []string{"echo", "hello from host1"})
		require.NoError(t, err)
		assert.Equal(t, 0, code)
		assert.Equal(t, "hello from host1\n", out)
	})

	t.Run("returns the output of stderr too", func(t *testing.T) {
		out, code, err := l.provider.Exec(
			ctx,
			l.name,
			"host1",
			[]string{"sh", "-c", "echo to-stdout; echo to-stderr >&2"},
		)
		require.NoError(t, err)
		assert.Equal(t, 0, code)
		assert.Contains(t, out, "to-stdout")
		assert.Contains(t, out, "to-stderr")
	})

	t.Run("returns the exit code of a failing command", func(t *testing.T) {
		_, code, err := l.provider.Exec(ctx, l.name, "host1", []string{"sh", "-c", "exit 3"})
		require.NoError(t, err)
		assert.Equal(t, 3, code)
	})

	// The instance service tells a node without an SSH client apart by these codes
	t.Run("reports a missing command like a shell does", func(t *testing.T) {
		_, code, err := l.provider.Exec(ctx, l.name, "host1", []string{"antimony-no-such-command"})
		require.NoError(t, err)
		assert.Contains(t, []int{126, 127}, code)
	})

	t.Run("runs in the right node", func(t *testing.T) {
		out, _, err := l.provider.Exec(ctx, l.name, "host2", []string{"hostname"})
		require.NoError(t, err)
		assert.Contains(t, strings.TrimSpace(out), "host2")
	})

	t.Run("fails for an unknown node", func(t *testing.T) {
		_, _, err := l.provider.Exec(ctx, l.name, "missing", []string{"true"})
		assertNodeUnavailable(t, err)
	})
}

func (l *e2eLab) testNetworkInterfaces(t *testing.T) {
	interfaces, err := l.provider.GetNetworkInterfaces(t.Context(), l.name, "host1")
	require.NoError(t, err)

	names := lo.Map(interfaces, func(i NodeInterface, _ int) string { return i.Name })
	assert.NotContains(t, names, "lo")
	require.Contains(t, names, "eth1", "the link's interface is missing")

	eth1, _ := lo.Find(interfaces, func(i NodeInterface) bool { return i.Name == "eth1" })
	assert.Positive(t, eth1.MTU)
	assert.Regexp(t, `^([0-9a-f]{2}:){5}[0-9a-f]{2}$`, eth1.Address)
	assert.NotEmpty(t, eth1.State)

	t.Run("fails for an unknown node", func(t *testing.T) {
		_, err := l.provider.GetNetworkInterfaces(t.Context(), l.name, "missing")
		assertNodeUnavailable(t, err)
	})
}

// testLinkBetweenNodes addresses the link, the tests after it send traffic over it.
func (l *e2eLab) testLinkBetweenNodes(t *testing.T) {
	l.mustExec(t, "host1", "ip", "addr", "add", e2eHost1Address+"/30", "dev", "eth1")
	l.mustExec(t, "host2", "ip", "addr", "add", e2eHost2Address+"/30", "dev", "eth1")
	l.mustExec(t, "host1", "ip", "link", "set", "eth1", "up")
	l.mustExec(t, "host2", "ip", "link", "set", "eth1", "up")

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		_, code, err := l.provider.Exec(
			t.Context(),
			l.name,
			"host1",
			[]string{"ping", "-c", "1", "-W", "1", e2eHost2Address},
		)
		require.NoError(c, err)
		assert.Equal(c, 0, code)
	}, 30*time.Second, time.Second, "host1 can't reach host2 over the link")
}

func (l *e2eLab) testDialNode(t *testing.T) {
	// The listener answers one connection with a greeting and prints what it receives
	listener := fmt.Sprintf(
		"nohup sh -c 'echo dial-greeting | nc -l -p %d > /tmp/received' > /dev/null 2>&1 &", e2eDialPort,
	)
	l.mustExec(t, "host2", "sh", "-c", listener)

	var greeting string
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		defer cancel()

		conn, err := l.provider.DialNode(ctx, l.name, "host2", e2eDialPort)
		require.NoError(c, err)

		_, err = io.WriteString(conn, "dial-request\n")
		require.NoError(c, err)

		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		line, err := bufio.NewReader(conn).ReadString('\n')
		_ = conn.Close()

		require.NoError(c, err)
		greeting = line
	}, 30*time.Second, time.Second)

	assert.Equal(t, "dial-greeting\n", greeting)
	assert.EventuallyWithT(t, func(c *assert.CollectT) {
		out, _, err := l.provider.Exec(t.Context(), l.name, "host2", []string{"cat", "/tmp/received"})
		require.NoError(c, err)
		assert.Equal(c, "dial-request\n", out)
	}, 10*time.Second, 200*time.Millisecond, "the node didn't receive what was sent")

	t.Run("fails for an unknown node", func(t *testing.T) {
		_, err := l.provider.DialNode(t.Context(), l.name, "missing", e2eDialPort)
		assertNodeUnavailable(t, err)
	})
}

func (l *e2eLab) testExecInteractive(t *testing.T) {
	session, err := l.provider.ExecInteractive(t.Context(), l.name, "host1", []string{"sh"})
	require.NoError(t, err)

	output := newOutputReader(session)

	require.NoError(t, session.Resize(100, 40))

	// The marker is computed by the shell, so the echoed input doesn't match it
	_, err = io.WriteString(session, "echo e2e-$((6*7))\n")
	require.NoError(t, err)
	output.waitFor(t, "e2e-42")

	_, err = io.WriteString(session, "stty size\n")
	require.NoError(t, err)
	output.waitFor(t, "40 100")

	require.NoError(t, session.Resize(120, 50))
	_, err = io.WriteString(session, "stty size\n")
	require.NoError(t, err)
	output.waitFor(t, "50 120")

	t.Run("closing ends the session", func(t *testing.T) {
		require.NoError(t, session.Close())
		output.waitForEnd(t)
	})

	// The shell service can resize or close a session while another goroutine closes it
	t.Run("resizing or closing a closed session is harmless", func(t *testing.T) {
		assert.NotPanics(t, func() { _ = session.Resize(80, 24) })
		assert.NotPanics(t, func() { _ = session.Close() })
	})

	t.Run("exiting the shell ends the session", func(t *testing.T) {
		session, err := l.provider.ExecInteractive(t.Context(), l.name, "host1", []string{"sh"})
		require.NoError(t, err)
		defer session.Close()

		output := newOutputReader(session)
		_, err = io.WriteString(session, "exit\n")
		require.NoError(t, err)
		output.waitForEnd(t)
	})

	t.Run("fails for a command that doesn't exist", func(t *testing.T) {
		l.knownBug(t, "clabernetes", "BUGS.md #12", func(t assert.TestingT) {
			session, err := l.provider.ExecInteractive(
				context.Background(),
				l.name,
				"host1",
				[]string{"antimony-no-such-shell"},
			)
			if session != nil {
				_ = session.Close()
			}
			assert.Error(t, err)
		})
	})

	t.Run("fails for an unknown node", func(t *testing.T) {
		_, err := l.provider.ExecInteractive(t.Context(), l.name, "missing", []string{"sh"})
		assertNodeUnavailable(t, err)
	})
}

func (l *e2eLab) testReadNodeStats(t *testing.T) {
	ctx := t.Context()

	first, err := l.provider.ReadNodeStats(ctx, l.name, "host1")
	require.NoError(t, err)
	assert.Positive(t, first.MemoryUsage)
	assert.Positive(t, first.MemoryLimit)
	assert.GreaterOrEqual(t, first.MemoryLimit, first.MemoryUsage)
	require.Contains(t, first.Interfaces, "eth1")

	l.mustExec(t, "host1", "ping", "-c", "5", "-i", "0.2", "-s", "1000", e2eHost2Address)

	var second *NodeStats
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		second, err = l.provider.ReadNodeStats(ctx, l.name, "host1")
		require.NoError(c, err)
		require.Contains(c, second.Interfaces, "eth1")
		assert.Greater(c, second.Interfaces["eth1"].TxBytes, first.Interfaces["eth1"].TxBytes+5000)
	}, 15*time.Second, 500*time.Millisecond, "the ping doesn't show up in the interface counters")

	assert.True(t, second.Timestamp.After(first.Timestamp))
	assert.GreaterOrEqual(t, second.CPUUsage, first.CPUUsage)
	assert.GreaterOrEqual(t, second.CPUUsagePercent, 0.0)

	t.Run("fails for an unknown node", func(t *testing.T) {
		_, err := l.provider.ReadNodeStats(ctx, l.name, "missing")
		assert.Error(t, err)
	})
}

func (l *e2eLab) testOpenCapture(t *testing.T) {
	ctx := t.Context()

	t.Run("fails for an unknown interface", func(t *testing.T) {
		capture, err := l.provider.OpenCapture(ctx, l.name, "host1", "eth9")
		if capture != nil {
			capture.Close()
		}
		assert.Error(t, err)
	})

	t.Run("fails for an unknown node", func(t *testing.T) {
		_, err := l.provider.OpenCapture(ctx, l.name, "missing", "eth1")
		assertNodeUnavailable(t, err)
	})

	capture, err := l.provider.OpenCapture(ctx, l.name, "host1", "eth1")
	require.NoError(t, err)
	defer capture.Close()

	packets := make(chan []byte, 64)
	readEnded := make(chan error, 1)
	go func() {
		for {
			data, _, err := capture.ReadPacketData()
			if err != nil {
				readEnded <- err
				return
			}
			select {
			case packets <- data:
			default:
			}
		}
	}()

	pinger, cancelPing := context.WithCancel(ctx)
	defer cancelPing()
	go func() {
		for pinger.Err() == nil {
			_, _, _ = l.provider.Exec(pinger, l.name, "host2", []string{"ping", "-c", "1", "-W", "1", e2eHost1Address})
		}
	}()

	found := false
	deadline := time.After(30 * time.Second)
	for !found {
		select {
		case data := <-packets:
			found = isICMPBetween(data, e2eHost2Address, e2eHost1Address)
		case err := <-readEnded:
			t.Fatalf("the capture ended before it saw the ping: %v", err)
		case <-deadline:
			t.Fatal("the capture didn't see the ping from host2")
		}
	}
	cancelPing()

	t.Run("closing ends a waiting read", func(t *testing.T) {
		capture.Close()

		select {
		case <-readEnded:
		case <-time.After(5 * time.Second):
			t.Fatal("the read didn't end after the capture was closed")
		}
	})
}

func (l *e2eLab) testStreamContainerLogs(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	logs := &logCollector{}
	require.NoError(t, l.provider.StreamContainerLogs(ctx, l.name, "host1", logs.log))

	assert.EventuallyWithT(t, func(c *assert.CollectT) {
		assert.True(c, slices.ContainsFunc(logs.all(), func(line string) bool {
			return strings.Contains(line, e2eLogMarker)
		}))
	}, 15*time.Second, 200*time.Millisecond, "the node's output didn't arrive")

	t.Run("fails for an unknown node", func(t *testing.T) {
		err := l.provider.StreamContainerLogs(ctx, l.name, "missing", logs.log)
		assertNodeUnavailable(t, err)
	})
}

func (l *e2eLab) testNodeLifecycle(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	events := &nodeEvents{}
	listenerEnded := make(chan error, 1)
	go func() {
		listenerEnded <- l.provider.RegisterListener(ctx, events.add)
	}()

	// The listener has no ready signal, an event that arrives before it listens would be lost
	time.Sleep(2 * time.Second)

	t.Run("a stopped node", func(t *testing.T) {
		events.reset()
		require.NoError(t, l.provider.StopNode(ctx, l.name, "host2"))

		l.waitForNodeState(t, "host2", NodeStates.Stopped)
		events.waitFor(t, l.name+"/host2")

		_, _, err := l.provider.Exec(ctx, l.name, "host2", []string{"true"})
		require.ErrorIs(t, err, utils.ErrNodeNotRunning)

		_, err = l.provider.GetNetworkInterfaces(ctx, l.name, "host2")
		require.ErrorIs(t, err, utils.ErrNodeNotRunning)

		_, err = l.provider.ReadNodeStats(ctx, l.name, "host2")
		require.Error(t, err)

		// The other node isn't affected
		host1, err := l.provider.InspectNode(ctx, l.topologyFile, l.name, "host1", nil)
		require.NoError(t, err)
		assert.Equal(t, NodeStates.Running, host1.State)
	})

	t.Run("a started node", func(t *testing.T) {
		events.reset()
		require.NoError(t, l.provider.StartNode(ctx, l.name, "host2"))

		l.waitForNodeState(t, "host2", NodeStates.Running)
		events.waitFor(t, l.name+"/host2")
		l.waitForExec(t, "host2")
	})

	t.Run("a restarted node", func(t *testing.T) {
		// The start time of the node's init process tells its runs apart
		startTime := []string{"sh", "-c", "cut -d' ' -f22 /proc/1/stat"}
		before := l.mustExec(t, "host1", startTime...)

		events.reset()
		require.NoError(t, l.provider.RestartNode(ctx, l.name, "host1"))

		events.waitFor(t, l.name+"/host1")
		l.waitForNodeState(t, "host1", NodeStates.Running)
		l.waitForExec(t, "host1")

		assert.NotEqual(t, before, l.mustExec(t, "host1", startTime...), "the node wasn't restarted")
	})

	t.Run("an unknown node", func(t *testing.T) {
		assertNodeUnavailable(t, l.provider.StopNode(ctx, l.name, "missing"))
		assertNodeUnavailable(t, l.provider.StartNode(ctx, l.name, "missing"))
		assertNodeUnavailable(t, l.provider.RestartNode(ctx, l.name, "missing"))
	})

	cancel()
	select {
	case <-listenerEnded:
	case <-time.After(10 * time.Second):
		t.Error("the listener didn't stop when its context ended")
	}
}

func (l *e2eLab) testRedeploy(t *testing.T) {
	// Redeploying starts over, a file left in a node is gone afterward
	l.mustExec(t, "host1", "touch", "/tmp/before-redeploy")

	ctx, cancel := context.WithTimeout(t.Context(), l.deployTimeout)
	defer cancel()

	logs := &logCollector{}
	require.NoError(t, l.provider.Redeploy(ctx, l.topologyFile, l.name, logs.log))

	l.waitForNodeState(t, "host1", NodeStates.Running)
	l.waitForNodeState(t, "host2", NodeStates.Running)
	l.waitForExec(t, "host1")

	_, code, err := l.provider.Exec(t.Context(), l.name, "host1", []string{"test", "-e", "/tmp/before-redeploy"})
	require.NoError(t, err)
	assert.Equal(t, 1, code, "the node wasn't recreated")
}

// testMissingNodeContainer removes a node's container behind the provider's back, the rest of the lab stays usable.
func (l *e2eLab) testMissingNodeContainer(t *testing.T) {
	provider, ok := l.provider.(*ContainerlabProvider)
	if !ok {
		t.Skip("only containerlab nodes can lose their container, clabernetes recreates a missing pod")
	}

	ctx := t.Context()

	containerId, err := provider.containerForNode(ctx, l.name, "host2")
	require.NoError(t, err)
	require.NoError(t, provider.client.ContainerRemove(ctx, containerId, container.RemoveOptions{Force: true}))

	nodes, err := l.provider.InspectLab(ctx, l.topologyFile, l.name, nil)
	require.NoError(t, err)
	assert.Equal(t, []string{"host1"}, nodeNames(nodes))

	host1, err := l.provider.InspectNode(ctx, l.topologyFile, l.name, "host1", nil)
	require.NoError(t, err)
	assert.Equal(t, NodeStates.Running, host1.State)

	_, err = l.provider.InspectNode(ctx, l.topologyFile, l.name, "host2", nil)
	assert.ErrorIs(t, err, utils.ErrNodeNotFound)
}

func (l *e2eLab) testDestroy(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()

	logs := &logCollector{}
	require.NoError(t, l.provider.Destroy(ctx, l.topologyFile, l.name, logs.log))

	_, err := l.provider.InspectLab(ctx, l.topologyFile, l.name, nil)
	require.ErrorIs(t, err, utils.ErrLabNotRunning)

	labs, err := l.provider.InspectLabs(ctx, nil)
	require.NoError(t, err)
	assert.NotContains(t, labs, l.name)

	_, _, err = l.provider.Exec(ctx, l.name, "host1", []string{"true"})
	assertNodeUnavailable(t, err)

	t.Run("destroying it again succeeds", func(t *testing.T) {
		assert.NoError(t, l.provider.Destroy(ctx, l.topologyFile, l.name, nil))
	})
}

/*
 * Helpers
 */

// knownBug runs assertions that a bug in BUGS.md makes fail with the given provider. While the bug is there, the
// failure is only logged. Once the assertions pass, the test fails, so the marker gets removed with the fix. With
// other providers the assertions apply as usual.
func (l *e2eLab) knownBug(t *testing.T, provider string, bug string, check func(t assert.TestingT)) {
	t.Helper()

	if l.providerName != provider {
		check(t)
		return
	}

	recorder := &failureRecorder{}
	check(recorder)

	if len(recorder.failures) == 0 {
		t.Errorf("%s doesn't happen anymore, remove the knownBug marker and the entry", bug)
		return
	}

	t.Logf("known bug, see %s:\n%s", bug, strings.Join(recorder.failures, "\n"))
}

// failureRecorder collects the failures of assertions instead of failing the test.
type failureRecorder struct {
	failures []string
}

func (r *failureRecorder) Errorf(format string, args ...any) {
	r.failures = append(r.failures, fmt.Sprintf(format, args...))
}

func (l *e2eLab) mustExec(t *testing.T, node string, cmd ...string) string {
	t.Helper()

	out, code, err := l.provider.Exec(t.Context(), l.name, node, cmd)
	require.NoError(t, err)
	require.Equalf(t, 0, code, "%v in %s failed: %s", cmd, node, out)

	return out
}

func (l *e2eLab) waitForNodeState(t *testing.T, node string, state NodeState) {
	t.Helper()

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		inspect, err := l.provider.InspectNode(t.Context(), l.topologyFile, l.name, node, nil)
		require.NoError(c, err)
		assert.Equal(c, state, inspect.State)
	}, l.deployTimeout, time.Second, "%s didn't reach state %d", node, state)
}

// waitForExec waits until a node runs commands, which can take a moment after it reports running.
func (l *e2eLab) waitForExec(t *testing.T, node string) {
	t.Helper()

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		_, code, err := l.provider.Exec(t.Context(), l.name, node, []string{"true"})
		require.NoError(c, err)
		assert.Equal(c, 0, code)
	}, time.Minute, time.Second, "%s doesn't run commands", node)
}

// assertNodeUnavailable accepts either error a provider uses for a node it can't act on.
func assertNodeUnavailable(t *testing.T, err error) {
	t.Helper()

	require.Error(t, err)
	assert.True(t,
		errors.Is(err, utils.ErrNodeNotFound) || errors.Is(err, utils.ErrNodeNotRunning),
		"expected the node to be reported as not found or not running, got: %v", err,
	)
}

func nodeNames(containers []InspectContainer) []string {
	return lo.Map(containers, func(c InspectContainer, _ int) string { return c.Name })
}

func randomSuffix(t *testing.T) string {
	t.Helper()

	b := make([]byte, 4)
	_, err := rand.Read(b)
	require.NoError(t, err)

	return hex.EncodeToString(b)
}

func isICMPBetween(data []byte, source, destination string) bool {
	packet := gopacket.NewPacket(data, layers.LayerTypeEthernet, gopacket.NoCopy)

	ip, ok := packet.Layer(layers.LayerTypeIPv4).(*layers.IPv4)
	if !ok || packet.Layer(layers.LayerTypeICMPv4) == nil {
		return false
	}

	return ip.SrcIP.String() == source && ip.DstIP.String() == destination
}

// nodeEvents records the nodes a provider's listener reports as "<instance>/<node>".
type nodeEvents struct {
	mu    sync.Mutex
	names []string
}

func (e *nodeEvents) add(instanceName string, nodeName string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.names = append(e.names, instanceName+"/"+nodeName)
}

func (e *nodeEvents) reset() {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.names = nil
}

func (e *nodeEvents) waitFor(t *testing.T, name string) {
	t.Helper()

	assert.EventuallyWithT(t, func(c *assert.CollectT) {
		e.mu.Lock()
		defer e.mu.Unlock()

		assert.Contains(c, e.names, name)
	}, time.Minute, 200*time.Millisecond, "the listener didn't report %s", name)
}

// outputReader collects the output of an interactive session in the background.
type outputReader struct {
	mu     sync.Mutex
	output strings.Builder
	ended  chan struct{}
}

func newOutputReader(r io.Reader) *outputReader {
	o := &outputReader{ended: make(chan struct{})}

	go func() {
		defer close(o.ended)

		buffer := make([]byte, 4096)
		for {
			n, err := r.Read(buffer)

			o.mu.Lock()
			o.output.Write(buffer[:n])
			o.mu.Unlock()

			if err != nil {
				return
			}
		}
	}()

	return o
}

func (o *outputReader) waitFor(t *testing.T, text string) {
	t.Helper()

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		o.mu.Lock()
		defer o.mu.Unlock()

		assert.Contains(c, o.output.String(), text)
	}, 15*time.Second, 100*time.Millisecond)
}

func (o *outputReader) waitForEnd(t *testing.T) {
	t.Helper()

	select {
	case <-o.ended:
	case <-time.After(10 * time.Second):
		t.Fatal("the session's output didn't end")
	}
}

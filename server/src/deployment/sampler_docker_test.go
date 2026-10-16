package deployment

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony-server/utils"
)

/*
 * dockerSampler
 *
 * The sampler reads a container's cgroup files and its /proc entries. The tests build both trees in a temp
 * directory, with the container's cgroup wherever a runtime would put it.
 */

const samplerTestPid = 4242

// samplerTree is a fake /proc and cgroup v2 hierarchy.
type samplerTree struct {
	procRoot   string
	cgroupRoot string
}

func newSamplerTree(t *testing.T) *samplerTree {
	t.Helper()

	root := t.TempDir()
	tree := &samplerTree{procRoot: filepath.Join(root, "proc"), cgroupRoot: filepath.Join(root, "cgroup")}

	tree.write(t, filepath.Join(tree.procRoot, "stat"), procStat)
	tree.write(t, filepath.Join(tree.procRoot, strconv.Itoa(samplerTestPid), "net", "dev"), procNetDev)

	return tree
}

func (tree *samplerTree) write(t *testing.T, path, content string) {
	t.Helper()

	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
}

// addContainer lists cgroupFile as the process' /proc/<pid>/cgroup and puts the container's cgroup files at
// cgroupDir, relative to the cgroup root.
func (tree *samplerTree) addContainer(t *testing.T, cgroupFile string, cgroupDir string) {
	t.Helper()

	tree.write(t, filepath.Join(tree.procRoot, strconv.Itoa(samplerTestPid), "cgroup"), cgroupFile)

	dir := filepath.Join(tree.cgroupRoot, cgroupDir)
	tree.write(t, filepath.Join(dir, "cpu.stat"), "usage_usec 2500\nuser_usec 2000\nsystem_usec 500")
	tree.write(t, filepath.Join(dir, "memory.current"), "104857600")
	tree.write(t, filepath.Join(dir, "memory.stat"), "anon 1000\ninactive_file 4857600")
	tree.write(t, filepath.Join(dir, "memory.max"), "max")
}

func (tree *samplerTree) sampler() *dockerSampler {
	return &dockerSampler{
		nodeResolver: func(context.Context, string, string) (dockerTarget, error) {
			return dockerTarget{fullContainerId: "abc123", pid: samplerTestPid}, nil
		},
		procRoot:          tree.procRoot,
		cgroupRoot:        tree.cgroupRoot,
		systemMemoryTotal: 1 << 34,
		targetCache:       make(map[dockerRef]dockerTarget),
	}
}

func TestDockerSampler_FindsTheCgroupOfEveryLayout(t *testing.T) {
	cases := map[string]struct {
		cgroupFile string
		cgroupDir  string
	}{
		"systemd driver":  {"0::/system.slice/docker-abc123.scope\n", "system.slice/docker-abc123.scope"},
		"cgroupfs driver": {"0::/docker/abc123\n", "docker/abc123"},
		"custom cgroup parent": {
			"0::/antimony.slice/docker-abc123.scope\n", "antimony.slice/docker-abc123.scope",
		},
		"rootless docker": {
			"0::/user.slice/user-1000.slice/user@1000.service/docker.service/abc123\n",
			"user.slice/user-1000.slice/user@1000.service/docker.service/abc123",
		},
		"podman": {
			"0::/machine.slice/libpod-abc123.scope/container\n",
			"machine.slice/libpod-abc123.scope/container",
		},
		"hybrid hierarchy": {
			"12:memory:/docker/abc123\n1:name=systemd:/docker/abc123\n0::/docker/abc123\n",
			"docker/abc123",
		},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			tree := newSamplerTree(t)
			tree.addContainer(t, c.cgroupFile, c.cgroupDir)

			sample, err := tree.sampler().Sample(t.Context(), dockerRef{"demo", "host1"})

			require.NoError(t, err)
			assert.Equal(t, uint64(2500*1000), sample.cpuNs)
			assert.Equal(t, uint64(104857600-4857600), sample.memUsage, "inactive file pages don't count")
			assert.Equal(t, uint64(1<<34), sample.memLimit, "an unlimited container is limited by the host's memory")
			assert.Equal(t, [2]uint64{123456, 654321}, sample.net["eth1"])
			assert.Equal(t, 2, sample.onlineCPUs)
		})
	}
}

func TestDockerSampler_ReportsACgroupOutsideItsNamespace(t *testing.T) {
	tree := newSamplerTree(t)
	tree.addContainer(t, "0::/../../system.slice/docker-abc123.scope\n", "system.slice/docker-abc123.scope")

	_, err := tree.sampler().Sample(t.Context(), dockerRef{"demo", "host1"})

	require.ErrorIs(t, err, errForeignCgroupNamespace)
	assert.NotErrorIs(t, err, utils.ErrNodeNotRunning, "the node runs, the server can't see it")
}

func TestDockerSampler_ReportsAnExitedProcessAsNotRunning(t *testing.T) {
	tree := newSamplerTree(t)

	_, err := tree.sampler().Sample(t.Context(), dockerRef{"demo", "host1"})

	assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
}

func TestDockerSampler_ForgetsAContainerWhoseCgroupIsGone(t *testing.T) {
	tree := newSamplerTree(t)
	tree.addContainer(t, "0::/docker/abc123\n", "docker/abc123")
	sampler := tree.sampler()

	_, err := sampler.Sample(t.Context(), dockerRef{"demo", "host1"})
	require.NoError(t, err)

	// The container was replaced, so its cgroup is gone
	require.NoError(t, os.RemoveAll(filepath.Join(tree.cgroupRoot, "docker", "abc123")))

	_, err = sampler.Sample(t.Context(), dockerRef{"demo", "host1"})
	require.ErrorIs(t, err, utils.ErrNodeNotRunning)
	assert.Empty(t, sampler.targetCache, "the next sample resolves the node again")
}

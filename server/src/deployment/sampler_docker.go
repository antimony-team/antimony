package deployment

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"

	"github.com/antimony-team/antimony-server/utils"
)

// dockerRef holds information to identify a nodeName's docker container.
type dockerRef struct {
	instanceName string
	nodeName     string
}

// dockerTarget is what the sampler actually reads: resolved once per
// container and cached until the container goes away.
type dockerTarget struct {
	fullContainerId string
	pid             int

	// cgroupDir is the container's cgroup v2 directory, which depends on the runtime's cgroup driver and parent
	cgroupDir string
}

// errForeignCgroupNamespace is returned when the server can't see the nodes' cgroups, because it runs in a cgroup
// namespace of its own.
var errForeignCgroupNamespace = errors.New(
	"the node's cgroup is outside the server's cgroup namespace, run the server in the host's cgroup namespace",
)

// resolveFunc turns a node into its container's full id and init pid.
type nodeResolveFunc func(ctx context.Context, instanceName, node string) (dockerTarget, error)

// dockerSampler reads container stats from this host's cgroup v2 tree and
// /proc. It only works when the containers share the backend's kernel, i.e.,
// for a containerlab provider that orchestrates containers on the same system.
type dockerSampler struct {
	nodeResolver nodeResolveFunc

	// procRoot and cgroupRoot are where /proc and the cgroup v2 hierarchy are mounted
	procRoot   string
	cgroupRoot string

	systemMemoryTotal uint64

	targetCache      map[dockerRef]dockerTarget
	targetCacheMutex sync.Mutex

	// System CPU is the same for every container, so it is read at most
	// every 200ms rather than once per container.
	sysMutex    sync.Mutex
	sysReadAt   time.Time
	sysCPUNs    uint64
	sysCPUCount int
}

func createDockerSampler(nodeResolver nodeResolveFunc) *dockerSampler {
	if _, err := os.Stat("/sys/fs/cgroup/cgroup.controllers"); err != nil {
		log.Fatalf("cgroup v2 is required for container stats: %v", err)
	}

	lines, err := readLines("/proc/meminfo")
	if err != nil {
		log.Fatalf("Failed to read /proc/meminfo: %v", err)
	}
	total := parseMemTotal(lines)
	if total == 0 {
		log.Fatal("No MemTotal line in /proc/meminfo")
	}

	return &dockerSampler{
		nodeResolver:      nodeResolver,
		procRoot:          "/proc",
		cgroupRoot:        "/sys/fs/cgroup",
		systemMemoryTotal: total,
		targetCache:       make(map[dockerRef]dockerTarget),
		targetCacheMutex:  sync.Mutex{},

		sysMutex: sync.Mutex{},
	}
}

func (s *dockerSampler) Sample(ctx context.Context, ref dockerRef) (statsSample, error) {
	target, err := s.getTarget(ctx, ref)
	if err != nil {
		return statsSample{}, err
	}

	sample, err := s.readTarget(target)
	if errors.Is(err, os.ErrNotExist) {
		// cgroup or /proc entry gone: the container was stopped or replaced
		s.forgetTarget(ref)
		return statsSample{}, fmt.Errorf("%w: %s/%s", utils.ErrNodeNotRunning, ref.instanceName, ref.nodeName)
	}

	return sample, err
}

func (s *dockerSampler) getTarget(ctx context.Context, ref dockerRef) (dockerTarget, error) {
	s.targetCacheMutex.Lock()
	t, ok := s.targetCache[ref]
	s.targetCacheMutex.Unlock()
	if ok {
		return t, nil
	}

	t, err := s.nodeResolver(ctx, ref.instanceName, ref.nodeName)
	if err != nil {
		return dockerTarget{}, err
	}

	t.cgroupDir, err = s.findCgroupDir(t.pid, t.fullContainerId)
	if errors.Is(err, os.ErrNotExist) {
		// The process exited since the container was inspected
		return dockerTarget{}, fmt.Errorf("%w: %s/%s", utils.ErrNodeNotRunning, ref.instanceName, ref.nodeName)
	}
	if err != nil {
		return dockerTarget{}, err
	}

	s.targetCacheMutex.Lock()
	s.targetCache[ref] = t
	s.targetCacheMutex.Unlock()
	return t, nil
}

func (s *dockerSampler) readTarget(target dockerTarget) (statsSample, error) {
	var sample statsSample

	base := target.cgroupDir

	cpuStat, err := readLines(filepath.Join(base, "cpu.stat"))
	if err != nil {
		return sample, err
	}
	sample.cpuNs = parseKeyedUint(cpuStat, "usage_usec") * 1000

	memCurrent, err := readUint(filepath.Join(base, "memory.current"))
	if err != nil {
		return sample, err
	}
	memStat, _ := readLines(filepath.Join(base, "memory.stat"))
	sample.memUsage = parseMemoryUsage(memCurrent, parseKeyedUint(memStat, "inactive_file"))

	memMax, err := os.ReadFile(filepath.Join(base, "memory.max"))
	if err != nil {
		return sample, err
	}
	sample.memLimit = parseMemoryMax(string(memMax), s.systemMemoryTotal)

	netDev, err := readLines(filepath.Join(s.procRoot, strconv.Itoa(target.pid), "net", "dev"))
	if err != nil {
		return sample, err
	}
	sample.net = parseNetDev(netDev)

	sample.systemNs, sample.onlineCPUs, err = s.systemCPU()
	return sample, err
}

// findCgroupDir returns the cgroup v2 directory of the container that runs a process. The kernel lists the process'
// cgroup in /proc/<pid>/cgroup, which works for every cgroup driver and parent, rootless runtimes included.
func (s *dockerSampler) findCgroupDir(pid int, containerId string) (string, error) {
	lines, err := readLines(filepath.Join(s.procRoot, strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return "", err
	}

	for _, line := range lines {
		path, ok := strings.CutPrefix(line, "0::")
		if !ok {
			continue
		}

		// A cgroup outside the reader's cgroup namespace is listed relative to it
		if strings.HasPrefix(path, "/..") {
			return "", errForeignCgroupNamespace
		}

		return filepath.Join(s.cgroupRoot, containerCgroup(path, containerId)), nil
	}

	return "", fmt.Errorf("process %d has no cgroup v2 entry", pid)
}

// containerCgroup returns the container's own cgroup from the cgroup of a process in it. Init systems like systemd
// move themselves into a child cgroup of the container (e.g. ".../docker-<id>.scope/init.scope"), which only accounts
// for themselves. The runtime names the container's cgroup after the container's id, so that is the deepest
// directory whose name contains it. Without such a directory, the process' own cgroup is used.
func containerCgroup(path string, containerId string) string {
	if containerId == "" {
		return path
	}

	for dir := path; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if strings.Contains(filepath.Base(dir), containerId) {
			return dir
		}
	}

	return path
}

func (s *dockerSampler) forgetTarget(ref dockerRef) {
	s.targetCacheMutex.Lock()
	delete(s.targetCache, ref)
	s.targetCacheMutex.Unlock()
}

func (s *dockerSampler) systemCPU() (uint64, int, error) {
	s.sysMutex.Lock()
	defer s.sysMutex.Unlock()

	if time.Since(s.sysReadAt) < 200*time.Millisecond {
		return s.sysCPUNs, s.sysCPUCount, nil
	}

	lines, err := readLines(filepath.Join(s.procRoot, "stat"))
	if err != nil {
		return 0, 0, err
	}
	s.sysCPUNs, s.sysCPUCount = parseProcStat(lines)
	s.sysReadAt = time.Now()

	return s.sysCPUNs, s.sysCPUCount, nil
}

func readLines(path string) ([]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return strings.Split(string(b), "\n"), nil
}

func readUint(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
}

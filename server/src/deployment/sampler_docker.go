package deployment

import (
	"antimonyBackend/utils"
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
}

// resolveFunc turns a node into its container's full id and init pid.
type nodeResolveFunc func(ctx context.Context, instanceName, node string) (dockerTarget, error)

// dockerSampler reads container stats from this host's cgroup v2 tree and
// /proc. It only works when the containers share the backend's kernel, i.e.,
// for a containerlab provider that orchestrates containers on the same system.
type dockerSampler struct {
	nodeResolver nodeResolveFunc

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

	s.targetCacheMutex.Lock()
	s.targetCache[ref] = t
	s.targetCacheMutex.Unlock()
	return t, nil
}

func (s *dockerSampler) readTarget(target dockerTarget) (statsSample, error) {
	var sample statsSample

	base := filepath.Join("/sys/fs/cgroup/system.slice", fmt.Sprintf("docker-%s.scope", target.fullContainerId))

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

	netDev, err := readLines(fmt.Sprintf("/proc/%d/net/dev", target.pid))
	if err != nil {
		return sample, err
	}
	sample.net = parseNetDev(netDev)

	sample.systemNs, sample.onlineCPUs, err = s.systemCPU()
	return sample, err
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

	lines, err := readLines("/proc/stat")
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

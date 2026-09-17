package deployment

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
)

// dockerRef holds information to identify a node's docker container.
type dockerRef struct {
	fullContainerId string
	pid             int
}

// dockerSampler reads container stats from this host's cgroup v2 tree and
// /proc. It only works when the containers share the backend's kernel, i.e.,
// for a containerlab provider that orchestrates containers on the same system.
type dockerSampler struct {
	systemMemoryTotal uint64

	// System CPU is the same for every container, so it is read at most
	// every 200ms rather than once per container.
	sysMu       sync.Mutex
	sysReadAt   time.Time
	sysCPUNs    uint64
	sysCPUCount int
}

func createDockerSampler() *dockerSampler {
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

	return &dockerSampler{systemMemoryTotal: total}
}

func (l *dockerSampler) Sample(_ context.Context, ref dockerRef) (statsSample, error) {
	var s statsSample

	base := filepath.Join("/sys/fs/cgroup/system.slice", fmt.Sprintf("docker-%s.scope", ref.fullContainerId))

	cpuStat, err := readLines(filepath.Join(base, "cpu.stat"))
	if err != nil {
		return s, err
	}
	s.cpuNs = parseKeyedUint(cpuStat, "usage_usec") * 1000

	memCurrent, err := readUint(filepath.Join(base, "memory.current"))
	if err != nil {
		return s, err
	}
	memStat, _ := readLines(filepath.Join(base, "memory.stat"))
	s.memUsage = parseMemoryUsage(memCurrent, parseKeyedUint(memStat, "inactive_file"))

	memMax, err := os.ReadFile(filepath.Join(base, "memory.max"))
	if err != nil {
		return s, err
	}
	s.memLimit = parseMemoryMax(string(memMax), l.systemMemoryTotal)

	netDev, err := readLines(fmt.Sprintf("/proc/%d/net/dev", ref.pid))
	if err != nil {
		return s, err
	}
	s.net = parseNetDev(netDev)

	s.systemNs, s.onlineCPUs, err = l.systemCPU()
	return s, err
}

func (l *dockerSampler) systemCPU() (uint64, int, error) {
	l.sysMu.Lock()
	defer l.sysMu.Unlock()

	if time.Since(l.sysReadAt) < 200*time.Millisecond {
		return l.sysCPUNs, l.sysCPUCount, nil
	}

	lines, err := readLines("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	l.sysCPUNs, l.sysCPUCount = parseProcStat(lines)
	l.sysReadAt = time.Now()

	return l.sysCPUNs, l.sysCPUCount, nil
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

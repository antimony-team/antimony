package deployment

import (
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

const clockTicks = 100

type (
	ContainerCGroup struct {
		pid        int
		cpuFile    string
		memCurrent string
		memStat    string
		memMax     string
	}

	StatsReader interface {
		ReadStats(containerId string, pid int) (*NodeStats, error)
		IsCgroupV2() bool
	}

	statsReader struct {
		isCgroupV2        bool
		systemMemoryTotal uint64

		containerStatsCache map[string]*NodeStats
		cgroupCache         map[string]*ContainerCGroup
		statsMutex          sync.Mutex

		// Cache system CPU stats so we don't need to read it for every container
		sysCPUMutex  sync.Mutex
		sysCPUTime   time.Time
		sysCPUTotal  uint64
		sysCPUOnline int
	}
)

func CreateStatsReader() StatsReader {
	var (
		systemMemoryTotal uint64
		err               error
	)

	if systemMemoryTotal, err = systemMemTotal(); err != nil {
		log.Fatalf("Failed to read total system memory: %v", err)
	}

	return &statsReader{
		isCgroupV2:        isCgroupV2(),
		systemMemoryTotal: systemMemoryTotal,

		containerStatsCache: make(map[string]*NodeStats),
		cgroupCache:         make(map[string]*ContainerCGroup),
		statsMutex:          sync.Mutex{},

		sysCPUMutex:  sync.Mutex{},
		sysCPUTime:   time.Now(),
		sysCPUTotal:  0,
		sysCPUOnline: 0,
	}
}

func (r *statsReader) ReadStats(containerId string, pid int) (*NodeStats, error) {
	r.statsMutex.Lock()
	cg := r.cgroupCache[containerId]
	prev := r.containerStatsCache[containerId]
	r.statsMutex.Unlock()

	if cg == nil {
		var err error
		if cg, err = r.resolveCgroup(pid); err != nil {
			return nil, err
		}
		r.statsMutex.Lock()
		r.cgroupCache[containerId] = cg
		r.statsMutex.Unlock()
	}

	cpuNs, err := r.readCPUUsage(cg)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.invalidate(containerId)
		}
		return nil, err
	}
	memUsage, memLimit, err := r.readMemory(cg)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.invalidate(containerId)
		}
		return nil, err
	}
	netCounters, err := r.readNetDev(cg.pid)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.invalidate(containerId)
		}
		return nil, err
	}
	systemNs, onlineCPUs, err := r.cachedSystemCPU()
	if err != nil {
		return nil, err
	}

	now := time.Now()

	cpuPercent := 0.0
	if prev != nil {
		cpuDelta := float64(cpuNs - prev.CPUUsage)
		sysDelta := float64(systemNs - prev.SystemUsage)
		if cpuDelta > 0 && sysDelta > 0 {
			cpuPercent = (cpuDelta / sysDelta) * float64(onlineCPUs) * 100.0
		}
	}

	var elapsed float64
	if prev != nil {
		elapsed = now.Sub(prev.Timestamp).Seconds()
	}

	interfaces := make(map[string]NodeInterfaceStats, len(netCounters))
	for name, c := range netCounters {
		rx, tx := c[0], c[1]
		var rxBps, txBps int
		if prev != nil && elapsed > 0 {
			if pi, ok := prev.Interfaces[name]; ok {
				rxBps = int(float64(rx-pi.RxBytes) / elapsed)
				txBps = int(float64(tx-pi.TxBytes) / elapsed)
			}
		}
		interfaces[name] = NodeInterfaceStats{RxBytes: rx, TxBytes: tx, RxBps: rxBps, TxBps: txBps}
	}

	nodeStats := &NodeStats{
		Timestamp:       now,
		CPUUsage:        cpuNs,
		SystemUsage:     systemNs,
		CPUUsagePercent: cpuPercent,
		MemoryUsage:     memUsage,
		MemoryLimit:     memLimit,
		Interfaces:      interfaces,
	}

	r.statsMutex.Lock()
	r.containerStatsCache[containerId] = nodeStats
	r.statsMutex.Unlock()

	return nodeStats, nil
}

func (r *statsReader) IsCgroupV2() bool {
	return r.isCgroupV2
}

func (r *statsReader) invalidate(id string) {
	r.statsMutex.Lock()
	delete(r.cgroupCache, id)
	delete(r.containerStatsCache, id)
	r.statsMutex.Unlock()
}

func (r *statsReader) resolveCgroup(
	pid int,
) (*ContainerCGroup, error) {
	// /proc/<pid>/cgroup gives us the exact path, regardless of systemd vs. cgroupfs driver.
	controllers, unified, err := parseProcCgroup(pid)
	if err != nil {
		return nil, err
	}

	cg := &ContainerCGroup{pid: pid}
	if r.IsCgroupV2() {
		base := filepath.Join("/sys/fs/cgroup", unified)
		cg.cpuFile = filepath.Join(base, "cpu.stat")
		cg.memCurrent = filepath.Join(base, "memory.current")
		cg.memStat = filepath.Join(base, "memory.stat")
		cg.memMax = filepath.Join(base, "memory.max")
	} else {
		cpuPath, memPath := controllers["cpuacct"], controllers["memory"]
		cg.cpuFile = filepath.Join("/sys/fs/cgroup/cpu,cpuacct", cpuPath, "cpuacct.usage")
		cg.memCurrent = filepath.Join("/sys/fs/cgroup/memory", memPath, "memory.usage_in_bytes")
		cg.memStat = filepath.Join("/sys/fs/cgroup/memory", memPath, "memory.stat")
		cg.memMax = filepath.Join("/sys/fs/cgroup/memory", memPath, "memory.limit_in_bytes")
	}

	return cg, nil
}

func parseProcCgroup(pid int) (map[string]string, string, error) {
	var unified string

	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return nil, "", err
	}
	controllers := make(map[string]string)
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		if parts[0] == "0" && parts[1] == "" {
			unified = parts[2]
			continue
		}
		for _, c := range strings.Split(parts[1], ",") {
			controllers[c] = parts[2]
		}
	}
	return controllers, unified, nil
}

func (r *statsReader) readCPUUsage(cg *ContainerCGroup) (uint64, error) {
	if r.isCgroupV2 {
		usec, err := readKeyedUint(cg.cpuFile, "usage_usec")
		if err != nil {
			return 0, err
		}
		return usec * 1000, nil
	}
	return readUint(cg.cpuFile)
}

func (r *statsReader) readMemory(cg *ContainerCGroup) (uint64, uint64, error) {
	cur, err := readUint(cg.memCurrent)
	if err != nil {
		return 0, 0, err
	}

	var usage, limit uint64

	var inactiveFile uint64
	if r.isCgroupV2 {
		inactiveFile, _ = readKeyedUint(cg.memStat, "inactive_file")
	} else {
		inactiveFile, _ = readKeyedUint(cg.memStat, "total_inactive_file")
	}
	if inactiveFile <= cur {
		usage = cur - inactiveFile
	} else {
		usage = cur
	}

	if limit, err = r.readMemoryMax(cg.memMax, r.isCgroupV2); err != nil {
		return 0, 0, err
	}

	return usage, limit, nil
}

func (r *statsReader) readMemoryMax(path string, v2 bool) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	s := strings.TrimSpace(string(b))
	if v2 && s == "max" {
		return r.systemMemoryTotal, nil
	}

	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, err
	}

	if v >= 0x7FFFFFFFFFFFF000 {
		return r.systemMemoryTotal, nil
	}

	return v, nil
}

func (r *statsReader) readNetDev(pid int) (map[string][2]uint64, error) {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/net/dev", pid))
	if err != nil {
		return nil, err
	}

	out := make(map[string][2]uint64)
	for _, line := range strings.Split(string(b), "\n") {
		i := strings.IndexByte(line, ':')
		if i < 0 {
			continue
		}
		name := strings.TrimSpace(line[:i])
		if name == "lo" {
			continue
		}
		f := strings.Fields(line[i+1:])
		if len(f) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		out[name] = [2]uint64{rx, tx}
	}

	return out, nil
}

func (r *statsReader) readSystemCPU() (uint64, int, error) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	var total uint64
	online := 0
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "cpu") || len(line) < 4 {
			continue
		}
		if line[3] == ' ' { // aggregate "cpu  ..."
			for _, f := range strings.Fields(line[4:]) {
				if v, e := strconv.ParseUint(f, 10, 64); e == nil {
					total += v
				}
			}
		} else { // per-core "cpuN ..."
			online++
		}
	}
	if online == 0 {
		online = 1
	}
	return total * 1_000_000_000 / clockTicks, online, nil // jiffies -> ns
}

func (r *statsReader) cachedSystemCPU() (uint64, int, error) {
	r.sysCPUMutex.Lock()
	defer r.sysCPUMutex.Unlock()

	if time.Since(r.sysCPUTime) < 200*time.Millisecond {
		return r.sysCPUTotal, r.sysCPUOnline, nil
	}
	t, n, err := r.readSystemCPU()
	if err != nil {
		return 0, 0, err
	}
	r.sysCPUTotal, r.sysCPUOnline, r.sysCPUTime = t, n, time.Now()

	return t, n, nil
}

func systemMemTotal() (uint64, error) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, err
	}

	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				kb, e := strconv.ParseUint(f[1], 10, 64)
				if e != nil {
					return 0, e
				}

				return kb * 1024, nil
			}
		}
	}

	return 0, fmt.Errorf("no MemTotal line in /proc/meminfo")
}

func readUint(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	return strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
}

func readKeyedUint(path, key string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	prefix := key + " "
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, prefix) {
			return strconv.ParseUint(strings.TrimSpace(line[len(key):]), 10, 64)
		}
	}

	return 0, nil
}

func isCgroupV2() bool {
	_, err := os.Stat("/sys/fs/cgroup/cgroup.controllers")
	return err == nil
}

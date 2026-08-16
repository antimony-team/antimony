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

type StatsReader struct {
	systemMemoryTotal uint64

	containerStatsCache map[string]*NodeStats
	cgroupCache         map[string]*containerCGroup
	statsMutex          sync.Mutex

	// Cache system CPU stats so we don't need to read it for every container
	sysCPUMutex  sync.Mutex
	sysCPUTime   time.Time
	sysCPUTotal  uint64
	sysCPUOnline int
}

type containerCGroup struct {
	pid        int
	cpuFile    string
	memCurrent string
	memStat    string
	memMax     string
}

func CreateStatsReader() *StatsReader {
	var (
		systemMemoryTotal uint64
		err               error
	)

	if systemMemoryTotal, err = systemMemTotal(); err != nil {
		log.Fatalf("Failed to read total system memory: %v", err)
	}

	if _, err = os.Stat("/sys/fs/cgroup/cgroup.controllers"); err != nil {
		log.Fatalf("CGroupV1 is not supported, please upgrade to CGroupV2: %v", err)
	}

	return &StatsReader{
		systemMemoryTotal: systemMemoryTotal,

		containerStatsCache: make(map[string]*NodeStats),
		cgroupCache:         make(map[string]*containerCGroup),
		statsMutex:          sync.Mutex{},

		sysCPUMutex:  sync.Mutex{},
		sysCPUTime:   time.Now(),
		sysCPUTotal:  0,
		sysCPUOnline: 0,
	}
}

func (r *StatsReader) ReadStats(fullContainerId string, pid int) (*NodeStats, error) {
	r.statsMutex.Lock()
	cg := r.cgroupCache[fullContainerId]
	prev := r.containerStatsCache[fullContainerId]
	r.statsMutex.Unlock()

	if cg == nil {
		cg = r.createCGroup(fullContainerId, pid)

		r.statsMutex.Lock()
		r.cgroupCache[fullContainerId] = cg
		r.statsMutex.Unlock()
	}

	cpuNs, err := r.readCPUUsage(cg)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.invalidate(fullContainerId)
		}
		return nil, err
	}
	memUsage, memLimit, err := r.readMemory(cg)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.invalidate(fullContainerId)
		}
		return nil, err
	}
	netCounters, err := r.readNetDev(cg.pid)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.invalidate(fullContainerId)
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
	r.containerStatsCache[fullContainerId] = nodeStats
	r.statsMutex.Unlock()

	return nodeStats, nil
}

func (r *StatsReader) invalidate(id string) {
	r.statsMutex.Lock()
	delete(r.cgroupCache, id)
	delete(r.containerStatsCache, id)
	r.statsMutex.Unlock()
}

func (r *StatsReader) createCGroup(
	fullContainerId string,
	pid int,
) *containerCGroup {
	base := filepath.Join("/sys/fs/cgroup/system.slice", fmt.Sprintf("docker-%s.scope", fullContainerId))

	return &containerCGroup{
		pid:        pid,
		cpuFile:    filepath.Join(base, "cpu.stat"),
		memCurrent: filepath.Join(base, "memory.current"),
		memStat:    filepath.Join(base, "memory.stat"),
		memMax:     filepath.Join(base, "memory.max"),
	}
}

func (r *StatsReader) readCPUUsage(cg *containerCGroup) (uint64, error) {
	usec, err := readKeyedUint(cg.cpuFile, "usage_usec")
	if err != nil {
		return 0, err
	}
	return usec * 1000, nil
}

func (r *StatsReader) readMemory(cg *containerCGroup) (uint64, uint64, error) {
	cur, err := readUint(cg.memCurrent)
	if err != nil {
		return 0, 0, err
	}

	var usage, limit uint64

	var inactiveFile uint64
	inactiveFile, _ = readKeyedUint(cg.memStat, "inactive_file")
	if inactiveFile <= cur {
		usage = cur - inactiveFile
	} else {
		usage = cur
	}

	if limit, err = r.readMemoryMax(cg.memMax); err != nil {
		return 0, 0, err
	}

	return usage, limit, nil
}

func (r *StatsReader) readMemoryMax(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	s := strings.TrimSpace(string(b))
	if s == "max" {
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

func (r *StatsReader) readNetDev(pid int) (map[string][2]uint64, error) {
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

func (r *StatsReader) readSystemCPU() (uint64, int, error) {
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

func (r *StatsReader) cachedSystemCPU() (uint64, int, error) {
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

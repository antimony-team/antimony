package deployment

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"time"
)

// sampler is a generic interface for sampling node stats.
type sampler[K any] interface {
	Sample(ctx context.Context, key K) (statsSample, error)
}

// clockTicks is the kernel's USER_HZ, used to convert /proc/stat jiffies to ns.
const clockTicks = 100

// statsSample is a snapshot of the raw counters needed to build NodeStats.
type statsSample struct {
	cpuNs      uint64
	systemNs   uint64
	onlineCPUs int
	memUsage   uint64
	memLimit   uint64
	net        map[string][2]uint64 // interface -> {rxBytes, txBytes}
}

type StatsReader[K any] struct {
	sampler sampler[K]

	mu        sync.Mutex
	nodeCache map[string]*NodeStats
}

func CreateStatsReader[K any](s sampler[K]) *StatsReader[K] {
	return &StatsReader[K]{sampler: s, nodeCache: make(map[string]*NodeStats)}
}

func (r *StatsReader[K]) Read(ctx context.Context, nodeId string, key K) (*NodeStats, error) {
	s, err := r.sampler.Sample(ctx, key)

	// If the sampler returns an error, forget the node and return nil.
	if err != nil {
		r.forget(nodeId)
		return nil, err
	}

	return r.compute(nodeId, s), nil
}

func (r *StatsReader[K]) compute(nodeId string, s statsSample) *NodeStats {
	r.mu.Lock()
	prev := r.nodeCache[nodeId]
	r.mu.Unlock()

	now := time.Now()

	cpuPercent := 0.0
	elapsed := 0.0
	if prev != nil {
		cpuDelta := float64(s.cpuNs - prev.CPUUsage)
		sysDelta := float64(s.systemNs - prev.SystemUsage)
		if cpuDelta > 0 && sysDelta > 0 {
			cpuPercent = (cpuDelta / sysDelta) * float64(s.onlineCPUs) * 100.0
		}
		elapsed = now.Sub(prev.Timestamp).Seconds()
	}

	interfaces := make(map[string]NodeInterfaceStats, len(s.net))
	for name, c := range s.net {
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

	stats := &NodeStats{
		Timestamp:       now,
		CPUUsage:        s.cpuNs,
		SystemUsage:     s.systemNs,
		CPUUsagePercent: cpuPercent,
		MemoryUsage:     s.memUsage,
		MemoryLimit:     s.memLimit,
		Interfaces:      interfaces,
	}

	r.mu.Lock()
	r.nodeCache[nodeId] = stats
	r.mu.Unlock()

	return stats
}

func (r *StatsReader[K]) forget(id string) {
	r.mu.Lock()
	delete(r.nodeCache, id)
	r.mu.Unlock()
}

// Parsing helpers shared by the local and remote samplers. They all operate
// on file contents split into lines, so the same code serves files read from
// disk and output captured from a remote shell.

// parseKeyedUint finds "key value" among lines and returns value, or 0.
func parseKeyedUint(lines []string, key string) uint64 {
	for _, l := range lines {
		if strings.HasPrefix(l, key+" ") {
			v, _ := strconv.ParseUint(strings.TrimSpace(l[len(key):]), 10, 64)
			return v
		}
	}
	return 0
}

// parseMemoryMax interprets a cgroup memory.max value; "max" and the kernel's
// unlimited sentinel both mean the whole system's memory.
func parseMemoryMax(s string, systemTotal uint64) uint64 {
	s = strings.TrimSpace(s)
	if s == "max" {
		return systemTotal
	}
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil || v >= 0x7FFFFFFFFFFFF000 {
		return systemTotal
	}
	return v
}

// parseMemoryUsage applies the same correction docker stats does: page cache
// that can be reclaimed (inactive_file) doesn't count as usage.
func parseMemoryUsage(current, inactiveFile uint64) uint64 {
	if inactiveFile <= current {
		return current - inactiveFile
	}
	return current
}

// parseProcStat sums the aggregate "cpu" line of /proc/stat into ns and counts
// the per-core lines.
func parseProcStat(lines []string) (systemNs uint64, onlineCPUs int) {
	var total uint64
	for _, line := range lines {
		if !strings.HasPrefix(line, "cpu") || len(line) < 4 {
			continue
		}
		if line[3] == ' ' {
			for _, f := range strings.Fields(line[4:]) {
				if v, err := strconv.ParseUint(f, 10, 64); err == nil {
					total += v
				}
			}
		} else {
			onlineCPUs++
		}
	}
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}
	return total * 1_000_000_000 / clockTicks, onlineCPUs
}

// parseMemTotal reads MemTotal from /proc/meminfo lines, in bytes.
func parseMemTotal(lines []string) uint64 {
	return parseKeyedUint(lines, "MemTotal:") * 1024
}

// parseNetDev reads /proc/net/dev lines into interface -> {rx, tx} bytes,
// skipping the loopback device.
func parseNetDev(lines []string) map[string][2]uint64 {
	out := make(map[string][2]uint64)
	for _, line := range lines {
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
	return out
}

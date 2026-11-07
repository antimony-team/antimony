package deployment

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const procStat = `cpu  100 20 30 400 5 0 6 0 0 0
cpu0 50 10 15 200 2 0 3 0 0 0
cpu1 50 10 15 200 3 0 3 0 0 0
intr 12345 0 0
ctxt 6789
btime 1700000000
processes 42`

const procMeminfo = `MemTotal:       16314356 kB
MemFree:         8123456 kB
MemAvailable:   12000000 kB
Buffers:          123456 kB`

const procNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:    1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0:    5000      50    0    0    0     0          0         0     7000      70    0    0    0     0       0          0
  eth1:  123456     100    0    0    0     0          0         0   654321     200    0    0    0     0       0          0`

func lines(text string) []string {
	return strings.Split(text, "\n")
}

func TestParseKeyedUint(t *testing.T) {
	cgroupStat := lines("usage_usec 2500\nuser_usec 2000\nsystem_usec 500")

	assert.Equal(t, uint64(2500), parseKeyedUint(cgroupStat, "usage_usec"))
	assert.Equal(t, uint64(500), parseKeyedUint(cgroupStat, "system_usec"))
	assert.Zero(t, parseKeyedUint(cgroupStat, "usage"), "a key only matches as a whole word")
	assert.Zero(t, parseKeyedUint(cgroupStat, "missing"))
	assert.Equal(t, uint64(16314356), parseKeyedUint(lines(procMeminfo), "MemTotal:"), "trailing units are ignored")
	assert.Equal(t, uint64(7), parseKeyedUint([]string{"key\t7"}, "key"), "a tab separates as well")
	assert.Zero(t, parseKeyedUint([]string{"key "}, "key"), "a key without a value")
	assert.Zero(t, parseKeyedUint([]string{"key abc"}, "key"), "a value that isn't a number")
	assert.Zero(t, parseKeyedUint(nil, "key"))
}

func TestParseMemoryMax(t *testing.T) {
	const systemTotal = 16 << 30

	cases := map[string]uint64{
		"max":                 systemTotal,
		" max\n":              systemTotal,
		"1073741824":          1 << 30,
		"1073741824\n":        1 << 30,
		"9223372036854771712": systemTotal, // the kernel's "unlimited" value
		"9223372036854775807": systemTotal,
		"not a number":        systemTotal,
		"":                    systemTotal,
	}

	for value, expected := range cases {
		t.Run(value, func(t *testing.T) {
			assert.Equal(t, expected, parseMemoryMax(value, systemTotal))
		})
	}
}

func TestParseMemoryUsage(t *testing.T) {
	assert.Equal(t, uint64(700), parseMemoryUsage(1000, 300), "reclaimable page cache doesn't count")
	assert.Equal(t, uint64(0), parseMemoryUsage(1000, 1000))
	assert.Equal(t, uint64(1000), parseMemoryUsage(1000, 1500), "an inactive file size above the usage is ignored")
	assert.Equal(t, uint64(1000), parseMemoryUsage(1000, 0))
}

func TestParseProcStat(t *testing.T) {
	systemNs, onlineCPUs := parseProcStat(lines(procStat))

	// The aggregate line sums to 561 jiffies, at 100 per second
	assert.Equal(t, uint64(561)*1_000_000_000/clockTicks, systemNs)
	assert.Equal(t, 2, onlineCPUs)

	t.Run("without per-core lines there is one CPU", func(t *testing.T) {
		_, onlineCPUs := parseProcStat([]string{"cpu  1 2 3"})
		assert.Equal(t, 1, onlineCPUs)
	})

	t.Run("invalid values and short lines are skipped", func(t *testing.T) {
		systemNs, onlineCPUs := parseProcStat([]string{"cpu  10 x 20", "cpu", "intr 5"})
		assert.Equal(t, uint64(30)*1_000_000_000/clockTicks, systemNs)
		assert.Equal(t, 1, onlineCPUs)
	})

	t.Run("nothing to read", func(t *testing.T) {
		systemNs, onlineCPUs := parseProcStat(nil)
		assert.Zero(t, systemNs)
		assert.Equal(t, 1, onlineCPUs)
	})
}

func TestParseMemTotal(t *testing.T) {
	assert.Equal(t, uint64(16314356)*1024, parseMemTotal(lines(procMeminfo)))
	assert.Zero(t, parseMemTotal([]string{"MemFree: 1 kB"}))
}

func TestParseNetDev(t *testing.T) {
	assert.Equal(t, map[string][2]uint64{
		"eth0": {5000, 7000},
		"eth1": {123456, 654321},
	}, parseNetDev(lines(procNetDev)), "the loopback device and the header are skipped")

	assert.Empty(t, parseNetDev([]string{"eth0: 1 2 3"}), "lines without the transmit columns are skipped")
	assert.Empty(t, parseNetDev(nil))
}

// remoteStatsOutput is one sample of remoteSampleScript.
func remoteStatsOutput(sections map[string]string) string {
	var output strings.Builder
	for _, name := range []string{"cpu", "memcur", "memmax", "memstat", "procstat", "meminfo", "netdev"} {
		content, ok := sections[name]
		if !ok {
			continue
		}
		output.WriteString("==" + name + "\n" + content + "\n")
	}
	return output.String()
}

func validRemoteSections() map[string]string {
	return map[string]string{
		"cpu":      "usage_usec 2500\nuser_usec 2000\nsystem_usec 500",
		"memcur":   "104857600",
		"memmax":   "max",
		"memstat":  "anon 1000\ninactive_file 4857600\nactive_file 10",
		"procstat": procStat,
		"meminfo":  procMeminfo,
		"netdev":   procNetDev,
	}
}

func TestParseRemoteStats(t *testing.T) {
	sample, err := parseRemoteStats(remoteStatsOutput(validRemoteSections()))
	require.NoError(t, err)

	assert.Equal(t, uint64(2500)*1000, sample.cpuNs)
	assert.Equal(t, uint64(104857600-4857600), sample.memUsage)
	assert.Equal(t, uint64(16314356)*1024, sample.memLimit, "max means the memory of the whole system")
	assert.Equal(t, uint64(561)*1_000_000_000/clockTicks, sample.systemNs)
	assert.Equal(t, 2, sample.onlineCPUs)
	assert.Equal(t, [2]uint64{123456, 654321}, sample.net["eth1"])

	t.Run("a memory limit is used as it is", func(t *testing.T) {
		sections := validRemoteSections()
		sections["memmax"] = "536870912"

		sample, err := parseRemoteStats(remoteStatsOutput(sections))
		require.NoError(t, err)
		assert.Equal(t, uint64(536870912), sample.memLimit)
	})

	t.Run("the memory statistics are optional", func(t *testing.T) {
		sections := validRemoteSections()
		delete(sections, "memstat")

		sample, err := parseRemoteStats(remoteStatsOutput(sections))
		require.NoError(t, err)
		assert.Equal(t, uint64(104857600), sample.memUsage)
	})

	for _, missing := range []string{"cpu", "memcur", "memmax", "procstat", "meminfo", "netdev"} {
		t.Run("missing "+missing, func(t *testing.T) {
			sections := validRemoteSections()
			delete(sections, missing)

			_, err := parseRemoteStats(remoteStatsOutput(sections))
			assert.ErrorContains(t, err, missing)
		})
	}

	t.Run("a memory usage that isn't a number", func(t *testing.T) {
		sections := validRemoteSections()
		sections["memcur"] = "cat: memory.current: No such file or directory"

		_, err := parseRemoteStats(remoteStatsOutput(sections))
		assert.ErrorContains(t, err, "memory.current")
	})
}

// fakeSampler returns the given samples one after the other.
type fakeSampler struct {
	samples []statsSample
	err     error
}

func (f *fakeSampler) Sample(context.Context, string) (statsSample, error) {
	if f.err != nil {
		return statsSample{}, f.err
	}

	sample := f.samples[0]
	f.samples = f.samples[1:]
	return sample, nil
}

func TestStatsReader_TheFirstSampleHasNoRates(t *testing.T) {
	reader := CreateStatsReader[string](&fakeSampler{samples: []statsSample{{
		cpuNs: 1000, systemNs: 10000, onlineCPUs: 2, memUsage: 5, memLimit: 10,
		net: map[string][2]uint64{"eth1": {100, 200}},
	}}})

	stats, err := reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)

	assert.Zero(t, stats.CPUUsagePercent)
	assert.Equal(t, uint64(5), stats.MemoryUsage)
	assert.Equal(t, uint64(10), stats.MemoryLimit)
	assert.Equal(t, NodeInterfaceStats{RxBytes: 100, TxBytes: 200}, stats.Interfaces["eth1"])
}

func TestStatsReader_RatesFollowFromTheLastSample(t *testing.T) {
	sampler := &fakeSampler{samples: []statsSample{
		{cpuNs: 1000, systemNs: 10000, onlineCPUs: 2, net: map[string][2]uint64{"eth1": {100, 200}}},
		{cpuNs: 2000, systemNs: 20000, onlineCPUs: 2, net: map[string][2]uint64{"eth1": {2100, 4200}, "eth2": {5, 5}}},
	}}
	reader := CreateStatsReader[string](sampler)

	_, err := reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)

	// Two seconds earlier, so the rates don't depend on how long the test takes
	reader.nodeCache["node"].Timestamp = time.Now().Add(-2 * time.Second)

	stats, err := reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)

	// The node used 1000 of 10000 ns of system time on 2 CPUs
	assert.InDelta(t, 20.0, stats.CPUUsagePercent, 0.001)
	assert.InDelta(t, 1000, stats.Interfaces["eth1"].RxBps, 10)
	assert.InDelta(t, 2000, stats.Interfaces["eth1"].TxBps, 20)
	assert.Equal(t, NodeInterfaceStats{RxBytes: 5, TxBytes: 5}, stats.Interfaces["eth2"],
		"a new interface has no rates yet")
}

func TestStatsReader_AFailedSampleForgetsTheNode(t *testing.T) {
	sampler := &fakeSampler{samples: []statsSample{
		{cpuNs: 1000, systemNs: 10000, onlineCPUs: 1},
		{cpuNs: 2000, systemNs: 20000, onlineCPUs: 1},
	}}
	reader := CreateStatsReader[string](sampler)

	_, err := reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)

	sampler.err = errors.New("node stopped")
	stats, err := reader.Read(t.Context(), "node", "key")
	require.Error(t, err)
	assert.Nil(t, stats)

	sampler.err = nil
	stats, err = reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)
	assert.Zero(t, stats.CPUUsagePercent, "after a failure the node starts over without rates")
}

// A node that restarts starts its counters over, the sample after that has no growth instead of a wrapped around
// difference, and the one after it has rates again.
func TestStatsReader_ResetCountersHaveNoRates(t *testing.T) {
	sampler := &fakeSampler{samples: []statsSample{
		{cpuNs: 5000, systemNs: 10000, onlineCPUs: 1, net: map[string][2]uint64{"eth1": {9000, 9000}}},
		{cpuNs: 100, systemNs: 20000, onlineCPUs: 1, net: map[string][2]uint64{"eth1": {10, 20}}},
		{cpuNs: 1100, systemNs: 30000, onlineCPUs: 1, net: map[string][2]uint64{"eth1": {2010, 4020}}},
	}}
	reader := CreateStatsReader[string](sampler)

	_, err := reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)
	reader.nodeCache["node"].Timestamp = time.Now().Add(-2 * time.Second)

	stats, err := reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)
	assert.Zero(t, stats.CPUUsagePercent)
	assert.Equal(t, NodeInterfaceStats{RxBytes: 10, TxBytes: 20}, stats.Interfaces["eth1"])

	reader.nodeCache["node"].Timestamp = time.Now().Add(-2 * time.Second)

	stats, err = reader.Read(t.Context(), "node", "key")
	require.NoError(t, err)
	assert.InDelta(t, 10.0, stats.CPUUsagePercent, 0.001)
	assert.InDelta(t, 1000, stats.Interfaces["eth1"].RxBps, 10)
	assert.InDelta(t, 2000, stats.Interfaces["eth1"].TxBps, 20)
}

func TestCounterDelta(t *testing.T) {
	assert.Equal(t, uint64(5), counterDelta(15, 10))
	assert.Zero(t, counterDelta(10, 10))
	assert.Zero(t, counterDelta(3, 10), "a counter that went down was reset")
	assert.Equal(t, uint64(math.MaxUint64), counterDelta(math.MaxUint64, 0))
}

// The parsers read output of the nodes, which a user can change, so they must never panic.
func FuzzParseRemoteStats(f *testing.F) {
	f.Add(remoteStatsOutput(validRemoteSections()))
	f.Add("==cpu\n==memcur\n==memmax\n==procstat\n==meminfo\n==netdev\n")
	f.Add("==\n==cpu\nusage_usec\n")
	f.Add("")

	f.Fuzz(func(t *testing.T, output string) {
		_, _ = parseRemoteStats(output)
		_, _ = parseProcStat(lines(output))
		_ = parseNetDev(lines(output))
		_ = parseMemoryMax(output, 1)
	})
}

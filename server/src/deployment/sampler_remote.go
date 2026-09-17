package deployment

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

// podRef holds information to identify a node's kubernetes podName.
type podRef struct {
	instanceName string
	podName      string
}

// execFunc runs cmd inside the node container of the given pod and returns
// its stdout. The clabernetes provider supplies this from its exec client.
type execFunc func(ctx context.Context, instanceName string, pod string, cmd []string) (string, int, error)

// remoteSampler collects stat samples by running a script inside the node container.
// With cgroup v2 and Docker's default private cgroup namespace, /sys/fs/cgroup
// inside the container is the container's own cgroup, so the script reads the
// same files the local sampler does.
type remoteSampler struct {
	exec execFunc
}

func createRemoteSampler(exec execFunc) *remoteSampler {
	return &remoteSampler{exec: exec}
}

// remoteStatsScript is the command that is executed on the remote machine that prints each procfs source file under
// a "==name" header so the output can be split back into sections.
const remoteStatsScript = `echo ==cpu
cat /sys/fs/cgroup/cpu.stat
echo ==memcur
cat /sys/fs/cgroup/memory.current
echo ==memmax
cat /sys/fs/cgroup/memory.max
echo ==memstat
cat /sys/fs/cgroup/memory.stat
echo ==procstat
cat /proc/stat
echo ==meminfo
cat /proc/meminfo
echo ==netdev
cat /proc/net/dev`

func (r *remoteSampler) Sample(ctx context.Context, ref podRef) (statsSample, error) {
	out, _, err := r.exec(
		ctx,
		ref.instanceName,
		ref.podName,
		[]string{"sh", "-c", remoteStatsScript},
	)
	if err != nil {
		return statsSample{}, err
	}

	return parseRemoteStats(out)
}

// parseRemoteStats parses the output of the remoteStatsScript command.
func parseRemoteStats(out string) (statsSample, error) {
	sections := make(map[string][]string)
	current := ""
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "==") {
			current = line[2:]
			continue
		}
		sections[current] = append(sections[current], line)
	}

	for _, required := range []string{"cpu", "memcur", "memmax", "procstat", "meminfo", "netdev"} {
		if len(sections[required]) == 0 {
			return statsSample{}, fmt.Errorf("stats output missing section %q", required)
		}
	}

	var s statsSample

	s.cpuNs = parseKeyedUint(sections["cpu"], "usage_usec") * 1000

	memCurrent, err := strconv.ParseUint(strings.TrimSpace(sections["memcur"][0]), 10, 64)
	if err != nil {
		return s, fmt.Errorf("parse memory.current: %w", err)
	}
	s.memUsage = parseMemoryUsage(memCurrent, parseKeyedUint(sections["memstat"], "inactive_file"))

	systemTotal := parseMemTotal(sections["meminfo"])
	s.memLimit = parseMemoryMax(sections["memmax"][0], systemTotal)

	s.systemNs, s.onlineCPUs = parseProcStat(sections["procstat"])
	s.net = parseNetDev(sections["netdev"])

	return s, nil
}

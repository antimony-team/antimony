package deployment

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"
)

// remoteSampleScript runs inside the node and emits one sample per second.
// Each source file is printed under a "==name" header so the output can be
// split back into sections, and every sample is terminated by "==end".
const remoteSampleScript = `while true; do
  echo ==cpu
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
  cat /proc/net/dev
  echo ==end
  sleep 1
done`

const (
	// streamIdleTimeout is how long a node's stream stays open with nobody
	// reading its samples before it is shut down.
	streamIdleTimeout = 30 * time.Second
	// firstSampleTimeout bounds how long the first sample call waits for the
	// stream to deliver anything.
	firstSampleTimeout = 10 * time.Second
)

// podRef holds information to identify a node's kubernetes podName.
type podRef struct {
	instanceName string
	podName      string
}

// streamingFunc runs cmd inside the node container of the given pod and returns
// its stdout. The clabernetes provider supplies this from its exec client.
type streamingFunc func(ctx context.Context, instanceName string, pod string, cmd []string, w io.Writer) error

// remoteSampler collects stat samples by running a script inside the node container.
// With cgroup v2 and Docker's default private cgroup namespace, /sys/fs/cgroup
// inside the container is the container's own cgroup, so the script reads the
// same files the local sampler does.
type remoteSampler struct {
	streamStarter streamingFunc

	streams      map[podRef]*nodeStream
	streamsMutex sync.Mutex
}

// nodeStream is one node's background sampling loop containing its latest result.
type nodeStream struct {
	cancel context.CancelFunc
	// Will be closed once the first sample arrives
	ready chan struct{}

	mu       sync.Mutex
	latest   statsSample
	hasValue bool
	lastRead time.Time
	done     bool
}

func createRemoteSampler(streamStarter streamingFunc) *remoteSampler {
	return &remoteSampler{streamStarter: streamStarter, streams: make(map[podRef]*nodeStream)}
}

// Sample returns the most recent sample for the node, starting its stream on
// first use. It only blocks while waiting for the very first sample.
func (r *remoteSampler) Sample(ctx context.Context, ref podRef) (statsSample, error) {
	ns := r.streamFor(ref)

	select {
	case <-ns.ready:
	case <-ctx.Done():
		return statsSample{}, ctx.Err()
	case <-time.After(firstSampleTimeout):
		return statsSample{}, fmt.Errorf("no stats received from %s/%s yet", ref.instanceName, ref.podName)
	}

	ns.mu.Lock()
	defer ns.mu.Unlock()

	ns.lastRead = time.Now()
	if ns.done {
		// Stream has ended (node restarted?); drop it so the next call reconnects.
		r.streamsMutex.Lock()
		delete(r.streams, ref)
		r.streamsMutex.Unlock()

		return statsSample{}, ErrNodeNotRunning
	}
	return ns.latest, nil
}

func (r *remoteSampler) streamFor(ref podRef) *nodeStream {
	r.streamsMutex.Lock()
	defer r.streamsMutex.Unlock()

	if ns, ok := r.streams[ref]; ok {
		return ns
	}

	// Start new stream if node has no stream yet.
	ctx, cancel := context.WithCancel(context.Background())
	ns := &nodeStream{cancel: cancel, ready: make(chan struct{}), lastRead: time.Now()}
	r.streams[ref] = ns

	go r.run(ctx, ref, ns)

	return ns
}

// run owns one node's stream: it feeds samples into ns and stops itself when
// the stream ends or nobody has read a sample for streamIdleTimeout.
func (r *remoteSampler) run(ctx context.Context, ref podRef, ns *nodeStream) {
	defer func() {
		ns.mu.Lock()
		ns.done = true
		ns.mu.Unlock()

		// Unblock the first-sample wait if the stream died before delivering.
		select {
		case <-ns.ready:
		default:
			close(ns.ready)
		}

		r.streamsMutex.Lock()
		if r.streams[ref] == ns {
			delete(r.streams, ref)
		}
		r.streamsMutex.Unlock()
	}()

	go func() {
		t := time.NewTicker(streamIdleTimeout / 2)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				ns.mu.Lock()
				idle := time.Since(ns.lastRead) > streamIdleTimeout
				ns.mu.Unlock()
				if idle {
					ns.cancel()
					return
				}
			}
		}
	}()

	pr, pw := io.Pipe()
	go func() {
		err := r.streamStarter(ctx, ref.instanceName, ref.podName, []string{"sh", "-c", remoteSampleScript}, pw)
		pw.CloseWithError(err)
	}()

	scanner := bufio.NewScanner(pr)
	var block []string
	for scanner.Scan() {
		line := scanner.Text()
		if line != "==end" {
			block = append(block, line)
			continue
		}
		if s, err := parseRemoteStats(strings.Join(block, "\n")); err == nil {
			ns.mu.Lock()
			ns.latest, ns.hasValue = s, true
			ns.mu.Unlock()
			select {
			case <-ns.ready:
			default:
				close(ns.ready)
			}
		}
		block = block[:0]
	}
}

// parseRemoteStats parses the output of the remoteSampleScript command.
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

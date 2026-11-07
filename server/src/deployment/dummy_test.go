package deployment

import "sync"

// The dummy provider is exercised by the Go test suite in the test package, this only makes sure it stays a
// complete provider.
var _ DeploymentProvider = (*DummyProvider)(nil)

// logCollector records the lines a provider writes to a log stream.
type logCollector struct {
	mu    sync.Mutex
	lines []string
}

func (c *logCollector) log(line string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.lines = append(c.lines, line)
}

// node records a node a listener reports as "<instance>/<node>".
func (c *logCollector) node(instanceName string, nodeName string) {
	c.log(instanceName + "/" + nodeName)
}

func (c *logCollector) all() []string {
	c.mu.Lock()
	defer c.mu.Unlock()

	return append([]string{}, c.lines...)
}

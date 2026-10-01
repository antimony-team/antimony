package deployment

import (
	"antimonyBackend/utils"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"

	"github.com/google/gopacket/afpacket"
	"gopkg.in/yaml.v3"
)

// ErrDummyProvider is returned by the parts of the dummy that have no meaningful test double.
var ErrDummyProvider = errors.New("dummy provider: not supported")

// DummyProvider is a programmable DeploymentProvider that deploys nothing and keeps all lab state in
// memory. It backs the Go test suite and can be selected with `deployment.provider: dummy` to run the
// server without containerlab or clabernetes, e.g. for end-to-end tests of the interface.
//
// Every method records its call (see Calls, CallCount, LastCall) and delegates to an overridable
// function field. The zero-configuration behaviour is "everything succeeds", so a test only has to
// describe the part of the world it actually cares about.
//
// The dummy keeps a per-instance node state machine. Deploy derives the nodes from the topology file
// it is handed, so deploying a seeded topology yields that topology's real node names without the
// test having to restate them. StartNode/StopNode/RestartNode mutate that state and the Inspect*
// methods read it back, which is what makes node-command transitions observable.
type DummyProvider struct {
	mu sync.Mutex

	calls []DummyProviderCall

	// instances maps an instance name to its nodes, keyed by node name.
	instances map[string]map[string]*DummyNode

	// listener is the callback captured from RegisterListener.
	listener func(nodeName string)

	// containerLogs holds the callbacks captured from StreamContainerLogs, keyed by
	// "<instanceName>/<nodeName>".
	containerLogs map[string]func(data string)

	// shells holds the sessions handed out by ExecInteractive, keyed by "<instanceName>/<nodeName>".
	shells map[string]*DummyShellSession

	// DeployStates is the state newly deployed nodes are reported in. Defaults to Running.
	DeployStates NodeState

	// Overridable behaviour. A nil field means "use the default".
	//
	// These are read by service goroutines (the monitor polls ReadNodeStats every second, startup
	// listeners call Exec), so they are guarded by the same mutex as the rest of the dummy and are
	// set through the SetXxx helpers rather than assigned directly.
	DeployFn          func(topologyFile, instanceName string, onLog LogFunc) error
	RedeployFn        func(topologyFile, instanceName string, onLog LogFunc) error
	DestroyFn         func(topologyFile, instanceName string, onLog LogFunc) error
	InspectLabsFn     func() (map[string][]InspectContainer, error)
	InspectLabFn      func(topologyFile, instanceName string) ([]InspectContainer, error)
	InspectNodeFn     func(topologyFile, instanceName, nodeName string) (InspectContainer, error)
	ExecFn            func(instanceName, nodeName string, cmd []string) (string, int, error)
	ExecInteractiveFn func(instanceName, nodeName string, cmd []string) (ShellExecSession, error)
	DialNodeFn        func(instanceName, nodeName string, port int) (net.Conn, error)
	StartNodeFn       func(instanceName, nodeName string) error
	StopNodeFn        func(instanceName, nodeName string) error
	RestartNodeFn     func(instanceName, nodeName string) error
	StreamLogsFn      func(instanceName, nodeName string, onLog LogFunc) error
	InterfacesFn      func(instanceName, nodeName string) ([]NodeInterface, error)
	StatsFn           func(instanceName, nodeName string) (*NodeStats, error)
}

// DummyNode is one node in the dummy provider's world.
type DummyNode struct {
	Name          string
	Kind          string
	Image         string
	State         NodeState
	ContainerId   string
	ContainerName string
	IPv4          string
	IPv6          string
}

// DummyProviderCall is a single recorded provider invocation.
type DummyProviderCall struct {
	Method string
	Args   map[string]any
}

func CreateDummyProvider() *DummyProvider {
	return &DummyProvider{
		calls:         make([]DummyProviderCall, 0),
		instances:     make(map[string]map[string]*DummyNode),
		containerLogs: make(map[string]func(string)),
		shells:        make(map[string]*DummyShellSession),
		DeployStates:  NodeStates.Running,
	}
}

/*
 * Test-facing controls.
 */

// Calls returns a copy of every recorded provider call, in order.
func (p *DummyProvider) Calls() []DummyProviderCall {
	p.mu.Lock()
	defer p.mu.Unlock()

	out := make([]DummyProviderCall, len(p.calls))
	copy(out, p.calls)

	return out
}

// CallCount reports how many times a method was invoked.
func (p *DummyProvider) CallCount(method string) int {
	count := 0
	for _, call := range p.Calls() {
		if call.Method == method {
			count++
		}
	}

	return count
}

// LastCall returns the most recent invocation of a method, or nil if it was never called.
func (p *DummyProvider) LastCall(method string) *DummyProviderCall {
	calls := p.Calls()
	for i := len(calls) - 1; i >= 0; i-- {
		if calls[i].Method == method {
			return &calls[i]
		}
	}

	return nil
}

// WasCalled reports whether a method was invoked at least once.
func (p *DummyProvider) WasCalled(method string) bool {
	return p.CallCount(method) > 0
}

// ResetCalls clears the call log without touching the node state. Useful to assert on what happened
// after a particular point in a test.
func (p *DummyProvider) ResetCalls() {
	p.mu.Lock()
	p.calls = make([]DummyProviderCall, 0)
	p.mu.Unlock()
}

// SeedInstance registers an instance as already deployed, without going through Deploy. This is how
// tests set up the world that instance.reviveInstances discovers on startup.
func (p *DummyProvider) SeedInstance(instanceName string, nodes ...DummyNode) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.putInstanceLocked(instanceName, nodes)
}

// SetNodeState changes a node's reported state, as an external event would.
func (p *DummyProvider) SetNodeState(instanceName, nodeName string, state NodeState) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if node := p.nodeLocked(instanceName, nodeName); node != nil {
		node.State = state
		p.applyStateSideEffectsLocked(node)
	}
}

// Node returns a copy of a node's current state, or nil if the dummy has never heard of it.
func (p *DummyProvider) Node(instanceName, nodeName string) *DummyNode {
	p.mu.Lock()
	defer p.mu.Unlock()

	if node := p.nodeLocked(instanceName, nodeName); node != nil {
		copied := *node
		return &copied
	}

	return nil
}

// HasInstance reports whether the dummy currently considers an instance deployed.
func (p *DummyProvider) HasInstance(instanceName string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	_, ok := p.instances[instanceName]

	return ok
}

// FireNodeEvent invokes the callback captured from RegisterListener, simulating a container event
// pushed by the deployment backend. It reports whether a listener was registered.
func (p *DummyProvider) FireNodeEvent(nodeName string) bool {
	p.mu.Lock()
	listener := p.listener
	p.mu.Unlock()

	if listener == nil {
		return false
	}

	listener(nodeName)

	return true
}

// PushContainerLog feeds a line into the callback captured from StreamContainerLogs. It reports
// whether a stream was registered for that node.
func (p *DummyProvider) PushContainerLog(instanceName, nodeName, line string) bool {
	p.mu.Lock()
	onLog := p.containerLogs[instanceName+"/"+nodeName]
	p.mu.Unlock()

	if onLog == nil {
		return false
	}

	onLog(line)

	return true
}

// Shell returns the interactive session handed out for a node, or nil if none was opened.
func (p *DummyProvider) Shell(instanceName, nodeName string) *DummyShellSession {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.shells[instanceName+"/"+nodeName]
}

// SetExecFn replaces the Exec behaviour. Safe to call while the dummy is in use.
func (p *DummyProvider) SetExecFn(fn func(instanceName, nodeName string, cmd []string) (string, int, error)) {
	p.mu.Lock()
	p.ExecFn = fn
	p.mu.Unlock()
}

// SetStatsFn replaces the ReadNodeStats behaviour. Safe to call while the monitor is polling.
func (p *DummyProvider) SetStatsFn(fn func(instanceName, nodeName string) (*NodeStats, error)) {
	p.mu.Lock()
	p.StatsFn = fn
	p.mu.Unlock()
}

func (p *DummyProvider) execFn() func(string, string, []string) (string, int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.ExecFn
}

func (p *DummyProvider) statsFn() func(string, string) (*NodeStats, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.StatsFn
}

/*
 * DeploymentProvider implementation.
 */

func (p *DummyProvider) Deploy(
	_ context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	p.record("Deploy", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.DeployFn != nil {
		return p.DeployFn(topologyFile, instanceName, onLog)
	}

	return p.deployDefault(topologyFile, instanceName, onLog, "Deploying")
}

func (p *DummyProvider) Redeploy(
	_ context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	p.record("Redeploy", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.RedeployFn != nil {
		return p.RedeployFn(topologyFile, instanceName, onLog)
	}

	return p.deployDefault(topologyFile, instanceName, onLog, "Redeploying")
}

func (p *DummyProvider) Destroy(
	_ context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	p.record("Destroy", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.DestroyFn != nil {
		return p.DestroyFn(topologyFile, instanceName, onLog)
	}

	onLog.Log(fmt.Sprintf("Destroying lab %s", instanceName))

	p.mu.Lock()
	delete(p.instances, instanceName)
	p.mu.Unlock()

	return nil
}

func (p *DummyProvider) InspectLabs(
	_ context.Context,
	_ LogFunc,
) (map[string][]InspectContainer, error) {
	p.record("InspectLabs", map[string]any{})

	if p.InspectLabsFn != nil {
		return p.InspectLabsFn()
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	out := make(map[string][]InspectContainer, len(p.instances))
	for instanceName := range p.instances {
		out[instanceName] = p.containersLocked(instanceName)
	}

	return out, nil
}

func (p *DummyProvider) InspectLab(
	_ context.Context,
	topologyFile string,
	instanceName string,
	_ LogFunc,
) ([]InspectContainer, error) {
	p.record("InspectLab", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.InspectLabFn != nil {
		return p.InspectLabFn(topologyFile, instanceName)
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if _, ok := p.instances[instanceName]; !ok {
		return nil, fmt.Errorf("%w: instance %q is not deployed", ErrDummyProvider, instanceName)
	}

	return p.containersLocked(instanceName), nil
}

func (p *DummyProvider) InspectNode(
	_ context.Context,
	topologyFile string,
	instanceName string,
	nodeName string,
	_ LogFunc,
) (InspectContainer, error) {
	p.record("InspectNode", map[string]any{
		"topologyFile": topologyFile,
		"instanceName": instanceName,
		"nodeName":     nodeName,
	})

	if p.InspectNodeFn != nil {
		return p.InspectNodeFn(topologyFile, instanceName, nodeName)
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	node := p.nodeLocked(instanceName, nodeName)
	if node == nil {
		return InspectContainer{}, fmt.Errorf(
			"%w: node %q not found in instance %q", ErrDummyProvider, nodeName, instanceName,
		)
	}

	return p.containerLocked(instanceName, node), nil
}

func (p *DummyProvider) Exec(
	_ context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (string, int, error) {
	p.record("Exec", map[string]any{"instanceName": instanceName, "nodeName": nodeName, "cmd": cmd})

	if fn := p.execFn(); fn != nil {
		return fn(instanceName, nodeName, cmd)
	}

	// Exit 127 means "no ssh client on the node", which instance.waitForNodeStarted treats as
	// "there is no SSH server to wait for". That makes nodes become ready promptly by default.
	return "sh: ssh: not found", 127, nil
}

func (p *DummyProvider) ExecInteractive(
	_ context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (ShellExecSession, error) {
	p.record("ExecInteractive", map[string]any{
		"instanceName": instanceName,
		"nodeName":     nodeName,
		"cmd":          cmd,
	})

	if p.ExecInteractiveFn != nil {
		return p.ExecInteractiveFn(instanceName, nodeName, cmd)
	}

	session := CreateDummyShellSession()

	p.mu.Lock()
	p.shells[instanceName+"/"+nodeName] = session
	p.mu.Unlock()

	return session, nil
}

func (p *DummyProvider) DialNode(
	_ context.Context,
	instanceName string,
	nodeName string,
	port int,
) (net.Conn, error) {
	p.record("DialNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName, "port": port})

	if p.DialNodeFn != nil {
		return p.DialNodeFn(instanceName, nodeName, port)
	}

	// Refusing the dial makes the shell service fall back to ExecInteractive, so tests do not need
	// to stand up a real SSH server.
	return nil, fmt.Errorf("%w: no SSH listener on %s/%s:%d", ErrDummyProvider, instanceName, nodeName, port)
}

func (p *DummyProvider) RegisterListener(_ context.Context, onUpdate func(nodeName string)) error {
	p.record("RegisterListener", map[string]any{})

	p.mu.Lock()
	p.listener = onUpdate
	p.mu.Unlock()

	return nil
}

func (p *DummyProvider) ReadNodeStats(
	_ context.Context,
	instanceName string,
	nodeName string,
) (*NodeStats, error) {
	p.record("ReadNodeStats", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if fn := p.statsFn(); fn != nil {
		return fn(instanceName, nodeName)
	}

	return &NodeStats{
		Timestamp:       time.Now(),
		CPUUsage:        1000,
		SystemUsage:     10000,
		CPUUsagePercent: 12.5,
		MemoryUsage:     1 << 20,
		MemoryLimit:     1 << 30,
		Interfaces: map[string]NodeInterfaceStats{
			"eth0": {RxBytes: 1024, TxBytes: 2048, RxBps: 128, TxBps: 256},
		},
	}, nil
}

func (p *DummyProvider) OpenCapture(
	_ context.Context,
	instanceName string,
	nodeName string,
	interfaceName string,
) (*afpacket.TPacket, error) {
	p.record("OpenCapture", map[string]any{
		"instanceName":  instanceName,
		"nodeName":      nodeName,
		"interfaceName": interfaceName,
	})

	return nil, fmt.Errorf("%w: packet capture cannot be faked", ErrDummyProvider)
}

func (p *DummyProvider) StartNode(_ context.Context, instanceName string, nodeName string) error {
	p.record("StartNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.StartNodeFn != nil {
		return p.StartNodeFn(instanceName, nodeName)
	}

	return p.transition(instanceName, nodeName, NodeStates.Running)
}

func (p *DummyProvider) StopNode(_ context.Context, instanceName string, nodeName string) error {
	p.record("StopNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.StopNodeFn != nil {
		return p.StopNodeFn(instanceName, nodeName)
	}

	return p.transition(instanceName, nodeName, NodeStates.Stopped)
}

func (p *DummyProvider) RestartNode(_ context.Context, instanceName string, nodeName string) error {
	p.record("RestartNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.RestartNodeFn != nil {
		return p.RestartNodeFn(instanceName, nodeName)
	}

	return p.transition(instanceName, nodeName, NodeStates.Running)
}

func (p *DummyProvider) StreamContainerLogs(
	_ context.Context,
	instanceName string,
	nodeName string,
	onLog LogFunc,
) error {
	p.record("StreamContainerLogs", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.StreamLogsFn != nil {
		return p.StreamLogsFn(instanceName, nodeName, onLog)
	}

	p.mu.Lock()
	p.containerLogs[instanceName+"/"+nodeName] = onLog
	p.mu.Unlock()

	return nil
}

func (p *DummyProvider) GetNetworkInterfaces(
	_ context.Context,
	instanceName string,
	nodeName string,
) ([]NodeInterface, error) {
	p.record("GetNetworkInterfaces", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.InterfacesFn != nil {
		return p.InterfacesFn(instanceName, nodeName)
	}

	// The node is shared with SetNodeState and the node commands, so its state has to be read while
	// the lock is still held.
	p.mu.Lock()
	node := p.nodeLocked(instanceName, nodeName)
	isRunning := node != nil && node.State == NodeStates.Running
	p.mu.Unlock()

	if !isRunning {
		return nil, utils.ErrNodeNotRunning
	}

	// "lo" is in the default excluded-interfaces list, so its presence here makes the interface
	// filter observable in tests.
	return []NodeInterface{
		{Name: "eth0", Address: "172.20.20.2/24", MTU: 1500, State: "up"},
		{Name: "eth1", Address: "", MTU: 1500, State: "down"},
		{Name: "lo", Address: "127.0.0.1/8", MTU: 65536, State: "up"},
	}, nil
}

/*
 * Internals.
 */

func (p *DummyProvider) record(method string, args map[string]any) {
	p.mu.Lock()
	p.calls = append(p.calls, DummyProviderCall{Method: method, Args: args})
	p.mu.Unlock()
}

func (p *DummyProvider) deployDefault(
	topologyFile string,
	instanceName string,
	onLog LogFunc,
	verb string,
) error {
	nodes, err := parseTopologyNodes(topologyFile)
	if err != nil {
		return err
	}

	onLog.Log(fmt.Sprintf("%s lab %s", verb, instanceName))

	p.mu.Lock()
	for i := range nodes {
		nodes[i].State = p.DeployStates
	}
	p.putInstanceLocked(instanceName, nodes)
	p.mu.Unlock()

	onLog.Log(fmt.Sprintf("%s: %d nodes ready", instanceName, len(nodes)))

	return nil
}

func (p *DummyProvider) transition(instanceName, nodeName string, state NodeState) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	node := p.nodeLocked(instanceName, nodeName)
	if node == nil {
		return fmt.Errorf("%w: node %q not found in instance %q", ErrDummyProvider, nodeName, instanceName)
	}

	node.State = state
	p.applyStateSideEffectsLocked(node)

	return nil
}

// applyStateSideEffectsLocked mirrors what a real backend does around a state change: a stopped node
// loses its container identity and addresses, a running one gets them back.
func (p *DummyProvider) applyStateSideEffectsLocked(node *DummyNode) {
	if node.State == NodeStates.Stopped {
		node.ContainerId = ""
		node.ContainerName = ""
		node.IPv4 = ""
		node.IPv6 = ""

		return
	}

	if node.ContainerId == "" {
		node.ContainerId = "container-" + node.Name
		node.ContainerName = "clab-" + node.Name
		node.IPv4 = "172.20.20.2"
		node.IPv6 = "3fff:172:20:20::2"
	}
}

func (p *DummyProvider) putInstanceLocked(instanceName string, nodes []DummyNode) {
	instance := make(map[string]*DummyNode, len(nodes))

	for _, node := range nodes {
		copied := node
		p.applyStateSideEffectsLocked(&copied)
		instance[copied.Name] = &copied
	}

	p.instances[instanceName] = instance
}

func (p *DummyProvider) nodeLocked(instanceName, nodeName string) *DummyNode {
	if instance, ok := p.instances[instanceName]; ok {
		return instance[nodeName]
	}

	return nil
}

func (p *DummyProvider) containersLocked(instanceName string) []InspectContainer {
	instance := p.instances[instanceName]

	out := make([]InspectContainer, 0, len(instance))
	for _, node := range instance {
		out = append(out, p.containerLocked(instanceName, node))
	}

	return out
}

func (p *DummyProvider) containerLocked(instanceName string, node *DummyNode) InspectContainer {
	return InspectContainer{
		Name:          node.Name,
		LabName:       instanceName,
		LabPath:       "/run/" + instanceName + "/topology.clab.yaml",
		Image:         node.Image,
		State:         node.State,
		ContainerId:   node.ContainerId,
		ContainerName: node.ContainerName,
		IPv4Address:   node.IPv4,
		IPv6Address:   node.IPv6,
	}
}

// parseTopologyNodes reads a containerlab topology file and returns one DummyNode per declared node.
func parseTopologyNodes(topologyFile string) ([]DummyNode, error) {
	data, err := os.ReadFile(topologyFile)
	if err != nil {
		return nil, fmt.Errorf("%w: reading topology %q: %w", ErrDummyProvider, topologyFile, err)
	}

	var definition struct {
		Topology struct {
			Nodes map[string]struct {
				Kind  string `yaml:"kind"`
				Image string `yaml:"image"`
			} `yaml:"nodes"`
		} `yaml:"topology"`
	}

	if err := yaml.Unmarshal(data, &definition); err != nil {
		return nil, fmt.Errorf("%w: parsing topology %q: %w", ErrDummyProvider, topologyFile, err)
	}

	nodes := make([]DummyNode, 0, len(definition.Topology.Nodes))
	for name, node := range definition.Topology.Nodes {
		nodes = append(nodes, DummyNode{Name: name, Kind: node.Kind, Image: node.Image})
	}

	return nodes, nil
}

/*
 * Dummy interactive shell session.
 */

// DummyShellSession is an in-memory ShellExecSession. Output the test pushes becomes
// readable by the server; everything the server writes is captured for assertions.
type DummyShellSession struct {
	mu      sync.Mutex
	written []byte
	resizes [][2]uint

	out       chan []byte
	pending   []byte
	closed    chan struct{}
	closeOnce sync.Once
}

func CreateDummyShellSession() *DummyShellSession {
	return &DummyShellSession{
		out:    make(chan []byte, 64),
		closed: make(chan struct{}),
	}
}

// Push makes data readable by whoever is reading the session, as node output would be.
func (s *DummyShellSession) Push(data string) {
	select {
	case s.out <- []byte(data):
	case <-s.closed:
	}
}

// Written returns everything the server has written into the session so far.
func (s *DummyShellSession) Written() string {
	s.mu.Lock()
	defer s.mu.Unlock()

	return string(s.written)
}

// Resizes returns the (cols, rows) pairs the session was resized to.
func (s *DummyShellSession) Resizes() [][2]uint {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([][2]uint, len(s.resizes))
	copy(out, s.resizes)

	return out
}

// IsClosed reports whether the session has been closed.
func (s *DummyShellSession) IsClosed() bool {
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

func (s *DummyShellSession) Read(p []byte) (int, error) {
	if len(s.pending) > 0 {
		n := copy(p, s.pending)
		s.pending = s.pending[n:]

		return n, nil
	}

	select {
	case data := <-s.out:
		n := copy(p, data)
		s.pending = data[n:]

		return n, nil
	case <-s.closed:
		return 0, io.EOF
	}
}

func (s *DummyShellSession) Write(p []byte) (int, error) {
	if s.IsClosed() {
		return 0, io.ErrClosedPipe
	}

	s.mu.Lock()
	s.written = append(s.written, p...)
	s.mu.Unlock()

	return len(p), nil
}

func (s *DummyShellSession) Close() error {
	s.closeOnce.Do(func() { close(s.closed) })

	return nil
}

func (s *DummyShellSession) Resize(cols uint, rows uint) error {
	if s.IsClosed() {
		return io.ErrClosedPipe
	}

	s.mu.Lock()
	s.resizes = append(s.resizes, [2]uint{cols, rows})
	s.mu.Unlock()

	return nil
}

package test

import (
	"antimonyBackend/deployment"
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

// errFakeProvider is returned by the parts of the fake that have no meaningful test double.
var errFakeProvider = errors.New("fake provider: not supported in tests")

// FakeProvider is a programmable deployment.DeploymentProvider.
//
// Every method records its call (see Calls, CallCount, LastCall) and delegates to an overridable
// function field. The zero-configuration behaviour is "everything succeeds", so a test only has to
// describe the part of the world it actually cares about.
//
// The fake keeps a per-instance node state machine. Deploy derives the nodes from the topology file
// it is handed, so deploying a seeded topology yields that topology's real node names without the
// test having to restate them. StartNode/StopNode/RestartNode mutate that state and the Inspect*
// methods read it back, which is what makes node-command transitions observable.
type FakeProvider struct {
	mu sync.Mutex

	calls []ProviderCall

	// instances maps an instance name to its nodes, keyed by node name.
	instances map[string]map[string]*FakeNode

	// listener is the callback captured from RegisterListener.
	listener func(nodeName string)

	// containerLogs holds the callbacks captured from StreamContainerLogs, keyed by
	// "<instanceName>/<nodeName>".
	containerLogs map[string]func(data string)

	// shells holds the sessions handed out by ExecInteractive, keyed by "<instanceName>/<nodeName>".
	shells map[string]*FakeShellSession

	// DeployStates is the state newly deployed nodes are reported in. Defaults to Running.
	DeployStates deployment.NodeState

	// Overridable behaviour. A nil field means "use the default".
	//
	// These are read by service goroutines (the monitor polls ReadNodeStats every second, startup
	// listeners call Exec), so they are guarded by the same mutex as the rest of the fake and are
	// set through the SetXxx helpers rather than assigned directly.
	DeployFn          func(topologyFile, instanceName string, onLog deployment.LogFunc) error
	RedeployFn        func(topologyFile, instanceName string, onLog deployment.LogFunc) error
	DestroyFn         func(topologyFile, instanceName string, onLog deployment.LogFunc) error
	InspectLabsFn     func() (map[string][]deployment.InspectContainer, error)
	InspectLabFn      func(topologyFile, instanceName string) ([]deployment.InspectContainer, error)
	InspectNodeFn     func(topologyFile, instanceName, nodeName string) (deployment.InspectContainer, error)
	ExecFn            func(instanceName, nodeName string, cmd []string) (string, int, error)
	ExecInteractiveFn func(instanceName, nodeName string, cmd []string) (deployment.ShellExecSession, error)
	DialNodeFn        func(instanceName, nodeName string, port int) (net.Conn, error)
	StartNodeFn       func(instanceName, nodeName string) error
	StopNodeFn        func(instanceName, nodeName string) error
	RestartNodeFn     func(instanceName, nodeName string) error
	StreamLogsFn      func(instanceName, nodeName string, onLog deployment.LogFunc) error
	InterfacesFn      func(instanceName, nodeName string) ([]deployment.NodeInterface, error)
	StatsFn           func(instanceName, nodeName string) (*deployment.NodeStats, error)
}

// FakeNode is one node in the fake provider's world.
type FakeNode struct {
	Name          string
	Kind          string
	Image         string
	State         deployment.NodeState
	ContainerId   string
	ContainerName string
	IPv4          string
	IPv6          string
}

// ProviderCall is a single recorded provider invocation.
type ProviderCall struct {
	Method string
	Args   map[string]any
}

func CreateFakeProvider() *FakeProvider {
	return &FakeProvider{
		calls:         make([]ProviderCall, 0),
		instances:     make(map[string]map[string]*FakeNode),
		containerLogs: make(map[string]func(string)),
		shells:        make(map[string]*FakeShellSession),
		DeployStates:  deployment.NodeStates.Running,
	}
}

/*
 * Test-facing controls.
 */

// Calls returns a copy of every recorded provider call, in order.
func (p *FakeProvider) Calls() []ProviderCall {
	p.mu.Lock()
	defer p.mu.Unlock()

	out := make([]ProviderCall, len(p.calls))
	copy(out, p.calls)

	return out
}

// CallCount reports how many times a method was invoked.
func (p *FakeProvider) CallCount(method string) int {
	count := 0
	for _, call := range p.Calls() {
		if call.Method == method {
			count++
		}
	}

	return count
}

// LastCall returns the most recent invocation of a method, or nil if it was never called.
func (p *FakeProvider) LastCall(method string) *ProviderCall {
	calls := p.Calls()
	for i := len(calls) - 1; i >= 0; i-- {
		if calls[i].Method == method {
			return &calls[i]
		}
	}

	return nil
}

// WasCalled reports whether a method was invoked at least once.
func (p *FakeProvider) WasCalled(method string) bool {
	return p.CallCount(method) > 0
}

// ResetCalls clears the call log without touching the node state. Useful to assert on what happened
// after a particular point in a test.
func (p *FakeProvider) ResetCalls() {
	p.mu.Lock()
	p.calls = make([]ProviderCall, 0)
	p.mu.Unlock()
}

// SeedInstance registers an instance as already deployed, without going through Deploy. This is how
// tests set up the world that instance.reviveInstances discovers on startup.
func (p *FakeProvider) SeedInstance(instanceName string, nodes ...FakeNode) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.putInstanceLocked(instanceName, nodes)
}

// SetNodeState changes a node's reported state, as an external event would.
func (p *FakeProvider) SetNodeState(instanceName, nodeName string, state deployment.NodeState) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if node := p.nodeLocked(instanceName, nodeName); node != nil {
		node.State = state
		p.applyStateSideEffectsLocked(node)
	}
}

// Node returns a copy of a node's current state, or nil if the fake has never heard of it.
func (p *FakeProvider) Node(instanceName, nodeName string) *FakeNode {
	p.mu.Lock()
	defer p.mu.Unlock()

	if node := p.nodeLocked(instanceName, nodeName); node != nil {
		copied := *node
		return &copied
	}

	return nil
}

// HasInstance reports whether the fake currently considers an instance deployed.
func (p *FakeProvider) HasInstance(instanceName string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	_, ok := p.instances[instanceName]

	return ok
}

// FireNodeEvent invokes the callback captured from RegisterListener, simulating a container event
// pushed by the deployment backend. It reports whether a listener was registered.
func (p *FakeProvider) FireNodeEvent(nodeName string) bool {
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
func (p *FakeProvider) PushContainerLog(instanceName, nodeName, line string) bool {
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
func (p *FakeProvider) Shell(instanceName, nodeName string) *FakeShellSession {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.shells[instanceName+"/"+nodeName]
}

// SetExecFn replaces the Exec behaviour. Safe to call while the fake is in use.
func (p *FakeProvider) SetExecFn(fn func(instanceName, nodeName string, cmd []string) (string, int, error)) {
	p.mu.Lock()
	p.ExecFn = fn
	p.mu.Unlock()
}

// SetStatsFn replaces the ReadNodeStats behaviour. Safe to call while the monitor is polling.
func (p *FakeProvider) SetStatsFn(fn func(instanceName, nodeName string) (*deployment.NodeStats, error)) {
	p.mu.Lock()
	p.StatsFn = fn
	p.mu.Unlock()
}

func (p *FakeProvider) execFn() func(string, string, []string) (string, int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.ExecFn
}

func (p *FakeProvider) statsFn() func(string, string) (*deployment.NodeStats, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.StatsFn
}

/*
 * deployment.DeploymentProvider implementation.
 */

func (p *FakeProvider) Deploy(
	_ context.Context,
	topologyFile string,
	instanceName string,
	onLog deployment.LogFunc,
) error {
	p.record("Deploy", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.DeployFn != nil {
		return p.DeployFn(topologyFile, instanceName, onLog)
	}

	return p.deployDefault(topologyFile, instanceName, onLog, "Deploying")
}

func (p *FakeProvider) Redeploy(
	_ context.Context,
	topologyFile string,
	instanceName string,
	onLog deployment.LogFunc,
) error {
	p.record("Redeploy", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.RedeployFn != nil {
		return p.RedeployFn(topologyFile, instanceName, onLog)
	}

	return p.deployDefault(topologyFile, instanceName, onLog, "Redeploying")
}

func (p *FakeProvider) Destroy(
	_ context.Context,
	topologyFile string,
	instanceName string,
	onLog deployment.LogFunc,
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

func (p *FakeProvider) InspectLabs(
	_ context.Context,
	_ deployment.LogFunc,
) (map[string][]deployment.InspectContainer, error) {
	p.record("InspectLabs", map[string]any{})

	if p.InspectLabsFn != nil {
		return p.InspectLabsFn()
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	out := make(map[string][]deployment.InspectContainer, len(p.instances))
	for instanceName := range p.instances {
		out[instanceName] = p.containersLocked(instanceName)
	}

	return out, nil
}

func (p *FakeProvider) InspectLab(
	_ context.Context,
	topologyFile string,
	instanceName string,
	_ deployment.LogFunc,
) ([]deployment.InspectContainer, error) {
	p.record("InspectLab", map[string]any{"topologyFile": topologyFile, "instanceName": instanceName})

	if p.InspectLabFn != nil {
		return p.InspectLabFn(topologyFile, instanceName)
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if _, ok := p.instances[instanceName]; !ok {
		return nil, fmt.Errorf("%w: instance %q is not deployed", errFakeProvider, instanceName)
	}

	return p.containersLocked(instanceName), nil
}

func (p *FakeProvider) InspectNode(
	_ context.Context,
	topologyFile string,
	instanceName string,
	nodeName string,
	_ deployment.LogFunc,
) (deployment.InspectContainer, error) {
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
		return deployment.InspectContainer{}, fmt.Errorf(
			"%w: node %q not found in instance %q", errFakeProvider, nodeName, instanceName,
		)
	}

	return p.containerLocked(instanceName, node), nil
}

func (p *FakeProvider) Exec(
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

func (p *FakeProvider) ExecInteractive(
	_ context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (deployment.ShellExecSession, error) {
	p.record("ExecInteractive", map[string]any{
		"instanceName": instanceName,
		"nodeName":     nodeName,
		"cmd":          cmd,
	})

	if p.ExecInteractiveFn != nil {
		return p.ExecInteractiveFn(instanceName, nodeName, cmd)
	}

	session := CreateFakeShellSession()

	p.mu.Lock()
	p.shells[instanceName+"/"+nodeName] = session
	p.mu.Unlock()

	return session, nil
}

func (p *FakeProvider) DialNode(
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
	return nil, fmt.Errorf("%w: no SSH listener on %s/%s:%d", errFakeProvider, instanceName, nodeName, port)
}

func (p *FakeProvider) RegisterListener(_ context.Context, onUpdate func(nodeName string)) error {
	p.record("RegisterListener", map[string]any{})

	p.mu.Lock()
	p.listener = onUpdate
	p.mu.Unlock()

	return nil
}

func (p *FakeProvider) ReadNodeStats(
	_ context.Context,
	instanceName string,
	nodeName string,
) (*deployment.NodeStats, error) {
	p.record("ReadNodeStats", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if fn := p.statsFn(); fn != nil {
		return fn(instanceName, nodeName)
	}

	return &deployment.NodeStats{
		Timestamp:       time.Now(),
		CPUUsage:        1000,
		SystemUsage:     10000,
		CPUUsagePercent: 12.5,
		MemoryUsage:     1 << 20,
		MemoryLimit:     1 << 30,
		Interfaces: map[string]deployment.NodeInterfaceStats{
			"eth0": {RxBytes: 1024, TxBytes: 2048, RxBps: 128, TxBps: 256},
		},
	}, nil
}

func (p *FakeProvider) OpenCapture(
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

	return nil, fmt.Errorf("%w: packet capture cannot be faked", errFakeProvider)
}

func (p *FakeProvider) StartNode(_ context.Context, instanceName string, nodeName string) error {
	p.record("StartNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.StartNodeFn != nil {
		return p.StartNodeFn(instanceName, nodeName)
	}

	return p.transition(instanceName, nodeName, deployment.NodeStates.Running)
}

func (p *FakeProvider) StopNode(_ context.Context, instanceName string, nodeName string) error {
	p.record("StopNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.StopNodeFn != nil {
		return p.StopNodeFn(instanceName, nodeName)
	}

	return p.transition(instanceName, nodeName, deployment.NodeStates.Stopped)
}

func (p *FakeProvider) RestartNode(_ context.Context, instanceName string, nodeName string) error {
	p.record("RestartNode", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.RestartNodeFn != nil {
		return p.RestartNodeFn(instanceName, nodeName)
	}

	return p.transition(instanceName, nodeName, deployment.NodeStates.Running)
}

func (p *FakeProvider) StreamContainerLogs(
	_ context.Context,
	instanceName string,
	nodeName string,
	onLog deployment.LogFunc,
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

func (p *FakeProvider) GetNetworkInterfaces(
	_ context.Context,
	instanceName string,
	nodeName string,
) ([]deployment.NodeInterface, error) {
	p.record("GetNetworkInterfaces", map[string]any{"instanceName": instanceName, "nodeName": nodeName})

	if p.InterfacesFn != nil {
		return p.InterfacesFn(instanceName, nodeName)
	}

	p.mu.Lock()
	node := p.nodeLocked(instanceName, nodeName)
	p.mu.Unlock()

	if node == nil || node.State != deployment.NodeStates.Running {
		return nil, utils.ErrNodeNotRunning
	}

	// "lo" is in the default excluded-interfaces list, so its presence here makes the interface
	// filter observable in tests.
	return []deployment.NodeInterface{
		{Name: "eth0", Address: "172.20.20.2/24", MTU: 1500, State: "up"},
		{Name: "eth1", Address: "", MTU: 1500, State: "down"},
		{Name: "lo", Address: "127.0.0.1/8", MTU: 65536, State: "up"},
	}, nil
}

/*
 * Internals.
 */

func (p *FakeProvider) record(method string, args map[string]any) {
	p.mu.Lock()
	p.calls = append(p.calls, ProviderCall{Method: method, Args: args})
	p.mu.Unlock()
}

func (p *FakeProvider) deployDefault(
	topologyFile string,
	instanceName string,
	onLog deployment.LogFunc,
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

func (p *FakeProvider) transition(instanceName, nodeName string, state deployment.NodeState) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	node := p.nodeLocked(instanceName, nodeName)
	if node == nil {
		return fmt.Errorf("%w: node %q not found in instance %q", errFakeProvider, nodeName, instanceName)
	}

	node.State = state
	p.applyStateSideEffectsLocked(node)

	return nil
}

// applyStateSideEffectsLocked mirrors what a real backend does around a state change: a stopped node
// loses its container identity and addresses, a running one gets them back.
func (p *FakeProvider) applyStateSideEffectsLocked(node *FakeNode) {
	if node.State == deployment.NodeStates.Stopped {
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

func (p *FakeProvider) putInstanceLocked(instanceName string, nodes []FakeNode) {
	instance := make(map[string]*FakeNode, len(nodes))

	for _, node := range nodes {
		copied := node
		p.applyStateSideEffectsLocked(&copied)
		instance[copied.Name] = &copied
	}

	p.instances[instanceName] = instance
}

func (p *FakeProvider) nodeLocked(instanceName, nodeName string) *FakeNode {
	if instance, ok := p.instances[instanceName]; ok {
		return instance[nodeName]
	}

	return nil
}

func (p *FakeProvider) containersLocked(instanceName string) []deployment.InspectContainer {
	instance := p.instances[instanceName]

	out := make([]deployment.InspectContainer, 0, len(instance))
	for _, node := range instance {
		out = append(out, p.containerLocked(instanceName, node))
	}

	return out
}

func (p *FakeProvider) containerLocked(instanceName string, node *FakeNode) deployment.InspectContainer {
	return deployment.InspectContainer{
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

// parseTopologyNodes reads a containerlab topology file and returns one FakeNode per declared node.
func parseTopologyNodes(topologyFile string) ([]FakeNode, error) {
	data, err := os.ReadFile(topologyFile)
	if err != nil {
		return nil, fmt.Errorf("%w: reading topology %q: %w", errFakeProvider, topologyFile, err)
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
		return nil, fmt.Errorf("%w: parsing topology %q: %w", errFakeProvider, topologyFile, err)
	}

	nodes := make([]FakeNode, 0, len(definition.Topology.Nodes))
	for name, node := range definition.Topology.Nodes {
		nodes = append(nodes, FakeNode{Name: name, Kind: node.Kind, Image: node.Image})
	}

	return nodes, nil
}

/*
 * Fake interactive shell session.
 */

// FakeShellSession is an in-memory deployment.ShellExecSession. Output the test pushes becomes
// readable by the server; everything the server writes is captured for assertions.
type FakeShellSession struct {
	mu      sync.Mutex
	written []byte
	resizes [][2]uint

	out       chan []byte
	pending   []byte
	closed    chan struct{}
	closeOnce sync.Once
}

func CreateFakeShellSession() *FakeShellSession {
	return &FakeShellSession{
		out:    make(chan []byte, 64),
		closed: make(chan struct{}),
	}
}

// Push makes data readable by whoever is reading the session, as node output would be.
func (s *FakeShellSession) Push(data string) {
	select {
	case s.out <- []byte(data):
	case <-s.closed:
	}
}

// Written returns everything the server has written into the session so far.
func (s *FakeShellSession) Written() string {
	s.mu.Lock()
	defer s.mu.Unlock()

	return string(s.written)
}

// Resizes returns the (cols, rows) pairs the session was resized to.
func (s *FakeShellSession) Resizes() [][2]uint {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([][2]uint, len(s.resizes))
	copy(out, s.resizes)

	return out
}

// IsClosed reports whether the session has been closed.
func (s *FakeShellSession) IsClosed() bool {
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

func (s *FakeShellSession) Read(p []byte) (int, error) {
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

func (s *FakeShellSession) Write(p []byte) (int, error) {
	if s.IsClosed() {
		return 0, io.ErrClosedPipe
	}

	s.mu.Lock()
	s.written = append(s.written, p...)
	s.mu.Unlock()

	return len(p), nil
}

func (s *FakeShellSession) Close() error {
	s.closeOnce.Do(func() { close(s.closed) })

	return nil
}

func (s *FakeShellSession) Resize(cols uint, rows uint) error {
	if s.IsClosed() {
		return io.ErrClosedPipe
	}

	s.mu.Lock()
	s.resizes = append(s.resizes, [2]uint{cols, rows})
	s.mu.Unlock()

	return nil
}

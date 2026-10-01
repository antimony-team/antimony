package deployment

import (
	"antimonyBackend/utils"
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	c9sv1alpha1 "github.com/clabernetes/clabernetes/apis/v1alpha1"
	clabernetescompiler "github.com/clabernetes/clabernetes/compiler"
	clabernetesconstants "github.com/clabernetes/clabernetes/constants"
	c9sfake "github.com/clabernetes/clabernetes/generated/clientset/fake"
	claberneteslogging "github.com/clabernetes/clabernetes/logging"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

/*
 * The clabernetes provider.
 *
 * The pure helpers come first: the translation between Antimony's topologies, c9s's objects and
 * the shared provider types. After them, everything that only reads and writes API objects runs
 * against fake Kubernetes and c9s clients. Exec, port forwarding and log streaming need a real
 * API server and are not covered here.
 */

// antimonyTopologyFixture is a topology as Antimony writes it: the UI's graph metadata lives in
// containerlab labels, including negative positions that are not valid Kubernetes label values.
const antimonyTopologyFixture = `name: demo
topology:
  defaults:
    labels:
      graph-group: core
  kinds:
    nokia_srlinux:
      labels:
        graph-icon: router
  groups:
    leafs:
      labels:
        graph-group: leafs
  nodes:
    srl1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:latest
      labels:
        graph-posX: -120.5
        graph-posY: 40.25
    host1:
      kind: linux
      image: alpine:latest
      exec:
        - ip link set eth1 up
      labels:
        graph-posX: 300
  links:
    - endpoints: ["srl1:e1-1", "host1:eth1"]
`

func compileTopology(definition string) error {
	_, err := clabernetescompiler.CompileTopology(&claberneteslogging.FakeInstance{}, &c9sv1alpha1.Topology{
		Spec: c9sv1alpha1.TopologySpec{Definition: c9sv1alpha1.Definition{Containerlab: definition}},
	})
	return err
}

/*
 * stripTopologyLabels
 */

func TestStripTopologyLabels_RemovesLabelsEverywhereTheyCanBeInherited(t *testing.T) {
	stripped, err := stripTopologyLabels([]byte(antimonyTopologyFixture))
	require.NoError(t, err)

	assert.NotContains(t, stripped, "labels")
	assert.NotContains(t, stripped, "graph-")
}

func TestStripTopologyLabels_KeepsEverythingElse(t *testing.T) {
	stripped, err := stripTopologyLabels([]byte(antimonyTopologyFixture))
	require.NoError(t, err)

	var definition map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(stripped), &definition))

	assert.Equal(t, "demo", definition["name"])

	topology := definition["topology"].(map[string]any)
	host := topology["nodes"].(map[string]any)["host1"].(map[string]any)
	assert.Equal(t, "linux", host["kind"])
	assert.Equal(t, "alpine:latest", host["image"])
	assert.Equal(t, []any{"ip link set eth1 up"}, host["exec"])
	assert.Len(t, topology["links"], 1)
}

func TestStripTopologyLabels_LeavesATopologyWithoutLabelsAlone(t *testing.T) {
	stripped, err := stripTopologyLabels([]byte("name: plain\ntopology:\n  nodes:\n    a: {kind: linux}\n"))
	require.NoError(t, err)

	assert.Contains(t, stripped, "name: plain")
	assert.Contains(t, stripped, "kind: linux")
}

func TestStripTopologyLabels_RejectsInvalidYaml(t *testing.T) {
	_, err := stripTopologyLabels([]byte("topology: [unclosed"))

	assert.Error(t, err)
}

/*
 * Compatibility with the c9s topology compiler.
 *
 * Deploy runs the same compiler as the c9s manager before applying a topology. These tests pin
 * down that Antimony's topologies only pass it because the labels are stripped, so a c9s upgrade
 * that changes either side shows up here instead of as a rejected deployment.
 */

func TestCompiler_RejectsAntimonyTopologiesWithGraphLabels(t *testing.T) {
	err := compileTopology(antimonyTopologyFixture)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "graph-posX")
}

func TestCompiler_AcceptsAntimonyTopologiesOnceTheLabelsAreStripped(t *testing.T) {
	stripped, err := stripTopologyLabels([]byte(antimonyTopologyFixture))
	require.NoError(t, err)

	assert.NoError(t, compileTopology(stripped))
}

/*
 * deviceContainer
 */

func TestDeviceContainer_PrefersTheDefaultContainerAnnotation(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{defaultContainerAnnotation: "device"}},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "card"}, {Name: "device"}}},
	}

	assert.Equal(t, "device", deviceContainer(pod))
}

func TestDeviceContainer_FallsBackToTheFirstContainer(t *testing.T) {
	pod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "first"}, {Name: "second"}}}}

	assert.Equal(t, "first", deviceContainer(pod))
}

func TestDeviceContainer_IsEmptyForAPodWithoutContainers(t *testing.T) {
	assert.Empty(t, deviceContainer(&corev1.Pod{}))
}

/*
 * podStateToNodeState
 */

func podWithPhase(phase corev1.PodPhase, ready bool) *corev1.Pod {
	status := corev1.ConditionFalse
	if ready {
		status = corev1.ConditionTrue
	}

	return &corev1.Pod{Status: corev1.PodStatus{
		Phase:      phase,
		Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: status}},
	}}
}

func TestPodStateToNodeState_MapsPodPhases(t *testing.T) {
	cases := map[string]struct {
		pod      *corev1.Pod
		expected NodeState
	}{
		"pending":           {podWithPhase(corev1.PodPending, false), NodeStates.Starting},
		"running not ready": {podWithPhase(corev1.PodRunning, false), NodeStates.Starting},
		"running and ready": {podWithPhase(corev1.PodRunning, true), NodeStates.Running},
		"succeeded":         {podWithPhase(corev1.PodSucceeded, false), NodeStates.Stopped},
		"failed":            {podWithPhase(corev1.PodFailed, false), NodeStates.Stopped},
		"unknown":           {podWithPhase(corev1.PodUnknown, false), NodeStates.Starting},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, c.expected, podStateToNodeState(c.pod))
		})
	}
}

/*
 * podToInspectContainer / stoppedDeploymentToInspectContainer
 */

func nodeLabels(node string) map[string]string {
	return map[string]string{
		clabernetesconstants.LabelTopologyNode:  node,
		clabernetesconstants.LabelTopologyOwner: "demo",
	}
}

func TestPodToInspectContainer_TranslatesTheNodePod(t *testing.T) {
	pod := podWithPhase(corev1.PodRunning, true)
	pod.ObjectMeta = metav1.ObjectMeta{
		Name:   "srl1-6f64979ddb-vhz58",
		UID:    "pod-uid",
		Labels: nodeLabels("srl1"),
	}
	pod.Spec.Containers = []corev1.Container{{Name: "device", Image: "ghcr.io/nokia/srlinux:latest"}}
	pod.Status.PodIPs = []corev1.PodIP{{IP: "10.244.0.42"}, {IP: "fd00::42"}}

	container := podToInspectContainer(pod, "/run/demo/topology.clab.yaml")

	assert.Equal(t, InspectContainer{
		Name:          "srl1",
		LabName:       "demo",
		LabPath:       "/run/demo/topology.clab.yaml",
		Image:         "ghcr.io/nokia/srlinux:latest",
		State:         NodeStates.Running,
		ContainerId:   "pod-uid",
		ContainerName: "srl1-6f64979ddb-vhz58",
		IPv4Address:   "10.244.0.42",
		IPv6Address:   "fd00::42",
	}, container)
}

func TestStoppedDeploymentToInspectContainer_ReportsAStoppedNodeWithoutAPod(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "srl1", Labels: nodeLabels("srl1")},
	}
	deployment.Spec.Template.Spec.Containers = []corev1.Container{{Name: "device", Image: "alpine:latest"}}

	container := stoppedDeploymentToInspectContainer(deployment, "/run/demo/topology.clab.yaml")

	assert.Equal(t, InspectContainer{
		Name:    "srl1",
		LabName: "demo",
		LabPath: "/run/demo/topology.clab.yaml",
		Image:   "alpine:latest",
		State:   NodeStates.Stopped,
	}, container)
}

/*
 * sortEvents / eventTime
 */

func TestEventTime_PrefersTheLastOccurrence(t *testing.T) {
	created := time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC)
	occurred := time.Date(2026, 10, 1, 11, 0, 0, 0, time.UTC)
	last := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

	event := corev1.Event{ObjectMeta: metav1.ObjectMeta{CreationTimestamp: metav1.NewTime(created)}}
	assert.Equal(t, created, eventTime(event), "falls back to the creation time")

	event.EventTime = metav1.NewMicroTime(occurred)
	assert.Equal(t, occurred, eventTime(event), "new-style events carry EventTime")

	event.LastTimestamp = metav1.NewTime(last)
	assert.Equal(t, last, eventTime(event), "legacy events carry LastTimestamp")
}

func TestSortEvents_OrdersByTimeThenName(t *testing.T) {
	second := metav1.NewTime(time.Date(2026, 10, 1, 14, 40, 15, 0, time.UTC))
	later := metav1.NewTime(second.Add(2 * time.Second))

	event := func(name string, at metav1.Time) corev1.Event {
		return corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: name}, LastTimestamp: at}
	}

	// Event names end in a nanosecond creation timestamp, which orders events within a second.
	events := []corev1.Event{
		event("srl.18da6ec9fcc2313e-later", later),
		event("srl.18da6eca04e4b1f8", second),
		event("srl.18da6ec9d6fa138f", second),
	}

	sortEvents(events)

	assert.Equal(t,
		[]string{"srl.18da6ec9d6fa138f", "srl.18da6eca04e4b1f8", "srl.18da6ec9fcc2313e-later"},
		[]string{events[0].Name, events[1].Name, events[2].Name},
	)
}

/*
 * conditionSummary
 */

func TestConditionSummary_JoinsTheFailingConditions(t *testing.T) {
	summary := conditionSummary([]metav1.Condition{
		{Type: "PlanApplied", Status: metav1.ConditionFalse, Message: "image pull secret missing"},
		{Type: "Prepared", Status: metav1.ConditionTrue, Message: "ignored"},
		{Type: "ContainersReady", Status: metav1.ConditionFalse, Message: "device crashed"},
		{Type: "Silent", Status: metav1.ConditionFalse},
	})

	assert.Equal(t, "PlanApplied: image pull secret missing; ContainersReady: device crashed", summary)
}

func TestConditionSummary_PointsToTheStatusWhenNothingFailed(t *testing.T) {
	assert.Equal(t, "see topology status", conditionSummary(nil))
}

/*
 * namespaceFor
 */

func TestNamespaceFor_PrefixesTheInstanceName(t *testing.T) {
	assert.Equal(t, "c9s-demo-1234", namespaceFor("demo-1234"))
}

/*
 * sizeQueue
 */

func TestSizeQueue_DeliversResizesInOrder(t *testing.T) {
	queue := createSizeQueue()

	queue.push(80, 24)
	queue.push(120, 40)

	assert.Equal(t, uint16(80), queue.Next().Width)
	assert.Equal(t, uint16(40), queue.Next().Height)
}

func TestSizeQueue_DropsResizesWhenFull(t *testing.T) {
	queue := createSizeQueue()

	assert.NotPanics(t, func() {
		for i := range 20 {
			queue.push(uint(i), uint(i))
		}
	}, "push must never block the caller")
	assert.Len(t, queue.ch, cap(queue.ch))
}

func TestSizeQueue_ReturnsNilOnceClosed(t *testing.T) {
	queue := createSizeQueue()
	close(queue.ch)

	assert.Nil(t, queue.Next(), "a nil size ends the remotecommand resize loop")
}

/*
 * Fake clients
 */

const fakeNamespace = "c9s-demo"

type fakeCluster struct {
	provider *ClabernetesProvider
	k8s      *k8sfake.Clientset
	c9s      *c9sfake.Clientset
}

func newFakeCluster(t *testing.T, k8sObjects []runtime.Object, c9sObjects []runtime.Object) *fakeCluster {
	t.Helper()

	k8s := k8sfake.NewClientset(k8sObjects...)
	c9s := c9sfake.NewSimpleClientset(c9sObjects...)

	return &fakeCluster{
		provider: &ClabernetesProvider{clientset: k8s, c9s: c9s},
		k8s:      k8s,
		c9s:      c9s,
	}
}

// linesContaining returns the collected log lines that contain substring.
func linesContaining(logs *logCollector, substring string) []string {
	return slices.DeleteFunc(logs.all(), func(line string) bool { return !strings.Contains(line, substring) })
}

func nodePod(name, node string, phase corev1.PodPhase, ready bool) *corev1.Pod {
	pod := podWithPhase(phase, ready)
	pod.ObjectMeta = metav1.ObjectMeta{
		Name:        name,
		Namespace:   fakeNamespace,
		UID:         types.UID("uid-" + name),
		Labels:      nodeLabels(node),
		Annotations: map[string]string{defaultContainerAnnotation: "device"},
	}
	pod.Spec.Containers = []corev1.Container{{Name: "device", Image: "alpine:latest"}}

	if phase == corev1.PodRunning {
		pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
			Name:  "device",
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		}}
	}

	return pod
}

func nodeDeployment(node string, replicas int32) *appsv1.Deployment {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: node, Namespace: fakeNamespace, Labels: nodeLabels(node)},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	deployment.Spec.Template.Spec.Containers = []corev1.Container{{Name: "device", Image: "alpine:latest"}}

	return deployment
}

func c9sNode(name string) *c9sv1alpha1.Node {
	return &c9sv1alpha1.Node{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: fakeNamespace}}
}

// markTopologiesRunning makes the fake c9s client report every created Topology as running, like the
// manager does once all nodes are ready.
func markTopologiesRunning(c9s *c9sfake.Clientset) {
	c9s.PrependReactor("create", "topologies", func(action k8stesting.Action) (bool, runtime.Object, error) {
		topology := action.(k8stesting.CreateAction).GetObject().(*c9sv1alpha1.Topology)
		topology.Status = c9sv1alpha1.TopologyStatus{
			TopologyState:  c9sv1alpha1.TopologyStateRunning,
			TopologyReady:  true,
			NodeCount:      2,
			ReadyNodeCount: 2,
		}
		return false, nil, nil // let the tracker store it
	})
}

func writeTopologyFile(t *testing.T, content string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "topology.clab.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))

	return path
}

/*
 * applyTopology
 */

func TestApplyTopology_CreatesAPrivilegedNamespaceAndTheTopology(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)
	definition := "name: demo\ntopology:\n  nodes:\n    a1: {kind: linux, image: alpine:latest}\n"

	require.NoError(t, cluster.provider.applyTopology(context.Background(), fakeNamespace, "demo", definition))

	namespace, err := cluster.k8s.CoreV1().Namespaces().Get(context.Background(), fakeNamespace, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "privileged", namespace.Labels["pod-security.kubernetes.io/enforce"])

	topology, err := cluster.c9s.C9sV1alpha1().
		Topologies(fakeNamespace).
		Get(context.Background(), "demo", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, definition, topology.Spec.Definition.Containerlab)
	assert.Equal(t, "None", topology.Spec.Expose.ExposeType, "nodes are reached through the provider, not services")
}

func TestApplyTopology_UpdatesAnExistingTopology(t *testing.T) {
	existing := &c9sv1alpha1.Topology{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: fakeNamespace},
		Spec:       c9sv1alpha1.TopologySpec{Definition: c9sv1alpha1.Definition{Containerlab: "name: old"}},
	}
	cluster := newFakeCluster(t, []runtime.Object{
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: fakeNamespace}},
	}, []runtime.Object{existing})
	definition := "name: demo\ntopology:\n  nodes:\n    a1: {kind: linux, image: alpine:latest}\n"

	require.NoError(t, cluster.provider.applyTopology(context.Background(), fakeNamespace, "demo", definition))

	topology, err := cluster.c9s.C9sV1alpha1().
		Topologies(fakeNamespace).
		Get(context.Background(), "demo", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, definition, topology.Spec.Definition.Containerlab)
}

func TestApplyTopology_RejectsUnsupportedTopologiesWithoutTouchingTheCluster(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)
	definition := `name: demo
topology:
  nodes:
    a1:
      kind: linux
      image: alpine:latest
      stages:
        create:
          wait-for: [{node: a2, stage: create}]
    a2: {kind: linux, image: alpine:latest}
`

	err := cluster.provider.applyTopology(context.Background(), fakeNamespace, "demo", definition)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "stages", "the c9s compiler's reason must be passed on")
	assert.Empty(t, cluster.k8s.Actions(), "no namespace may be created for a rejected topology")
	assert.Empty(t, cluster.c9s.Actions(), "no topology may be created for a rejected topology")
}

/*
 * Deploy
 */

func TestDeploy_AppliesTheTopologyWithoutLabelsAndWaitsUntilItRuns(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)
	markTopologiesRunning(cluster.c9s)
	logs := &logCollector{}

	err := cluster.provider.Deploy(
		context.Background(), writeTopologyFile(t, antimonyTopologyFixture), "demo", logs.log,
	)

	require.NoError(t, err)

	topology, err := cluster.c9s.C9sV1alpha1().
		Topologies(fakeNamespace).
		Get(context.Background(), "demo", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotContains(t, topology.Spec.Definition.Containerlab, "graph-", "Antimony's UI labels must be stripped")
	assert.NotEmpty(t, linesContaining(logs, "2/2 nodes ready"))
}

func TestDeploy_FailsRightAwayForUnsupportedTopologies(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)
	logs := &logCollector{}
	topologyFile := writeTopologyFile(t, "name: demo\ntopology:\n  nodes:\n    a1: {kind: linux, runtime: podman}\n")

	// Bounded so a regression fails here instead of waiting out the 10 minute deployment timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	start := time.Now()
	err := cluster.provider.Deploy(ctx, topologyFile, "demo", logs.log)

	require.Error(t, err)
	assert.Less(t, time.Since(start), time.Second, "a rejected topology must not wait for the deployment timeout")
	assert.NotEmpty(t, linesContaining(logs, "Creation of clabernetes topology failed"))
	assert.Empty(t, cluster.c9s.Actions())
}

func TestDeploy_FailsForAMissingTopologyFile(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)

	err := cluster.provider.Deploy(
		context.Background(), filepath.Join(t.TempDir(), "missing.yaml"), "demo", (&logCollector{}).log,
	)

	assert.Error(t, err)
}

/*
 * waitForTopologyReady
 */

func topologyWithStatus(status c9sv1alpha1.TopologyStatus) *c9sv1alpha1.Topology {
	return &c9sv1alpha1.Topology{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: fakeNamespace},
		Status:     status,
	}
}

func TestWaitForTopologyReady_ReturnsOnceTheTopologyRuns(t *testing.T) {
	cluster := newFakeCluster(t, nil, []runtime.Object{topologyWithStatus(c9sv1alpha1.TopologyStatus{
		TopologyState: c9sv1alpha1.TopologyStateRunning, NodeCount: 1, ReadyNodeCount: 1,
	})})

	assert.NoError(
		t,
		cluster.provider.waitForTopologyReady(context.Background(), fakeNamespace, "demo", (&logCollector{}).log),
	)
}

func TestWaitForTopologyReady_FailsWithTheFailingConditions(t *testing.T) {
	cluster := newFakeCluster(t, nil, []runtime.Object{topologyWithStatus(c9sv1alpha1.TopologyStatus{
		TopologyState: c9sv1alpha1.TopologyStateDeployFailed,
		Conditions: []metav1.Condition{
			{Type: "PlanApplied", Status: metav1.ConditionFalse, Message: "image pull secret missing"},
		},
	})})

	err := cluster.provider.waitForTopologyReady(context.Background(), fakeNamespace, "demo", (&logCollector{}).log)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "image pull secret missing")
}

func TestWaitForTopologyReady_StopsWhenTheContextEnds(t *testing.T) {
	// A topology the manager never reports on, e.g. one it failed to compile.
	cluster := newFakeCluster(t, nil, []runtime.Object{topologyWithStatus(c9sv1alpha1.TopologyStatus{})})
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	err := cluster.provider.waitForTopologyReady(ctx, fakeNamespace, "demo", (&logCollector{}).log)

	assert.Error(t, err)
}

/*
 * forwardDeployEvents
 */

func podEvent(name, pod, reason, message string, at time.Time) *corev1.Event {
	return &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: name, Namespace: fakeNamespace},
		InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: pod},
		Reason:         reason,
		Message:        message,
		Type:           corev1.EventTypeNormal,
		LastTimestamp:  metav1.NewTime(at),
		Count:          1,
	}
}

func TestForwardDeployEvents_ForwardsPodAndNodeEventsAttributedToTheirNode(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	nodeEvent := podEvent("srl1.2", "srl1", "PlanMissingInput", "device planning MissingInput", now)
	nodeEvent.InvolvedObject.Kind = "Node"
	nodeEvent.Type = corev1.EventTypeWarning

	cluster := newFakeCluster(t, []runtime.Object{
		nodePod("srl1-6f64979ddb-vhz58", "srl1", corev1.PodPending, false),
		podEvent("srl1-6f64979ddb-vhz58.1", "srl1-6f64979ddb-vhz58", "Pulling", "Pulling image", now),
		nodeEvent,
	}, nil)
	logs := &logCollector{}

	cluster.provider.forwardDeployEvents(context.Background(), fakeNamespace, now, map[string]int32{}, logs.log)

	lines := logs.all()
	require.Len(t, lines, 2)
	assert.Contains(t, lines[0], "KUBE")
	assert.Contains(t, lines[0], "Pulling image node=srl1 reason=Pulling", "pod events belong to the pod's node")
	assert.Contains(t, lines[1], "WARNING")
	assert.Contains(t, lines[1], "node=srl1 reason=PlanMissingInput")
}

func TestForwardDeployEvents_SkipsEventsOfOtherObjectsAndEarlierDeployments(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	deploymentEvent := podEvent("srl1.1", "srl1", "ScalingReplicaSet", "Scaled up", now)
	deploymentEvent.InvolvedObject.Kind = "Deployment"

	cluster := newFakeCluster(t, []runtime.Object{
		deploymentEvent,
		podEvent("old.1", "old-pod", "Pulled", "from an earlier deployment", now.Add(-time.Minute)),
	}, nil)
	logs := &logCollector{}

	cluster.provider.forwardDeployEvents(context.Background(), fakeNamespace, now, map[string]int32{}, logs.log)

	assert.Empty(t, logs.all())
}

func TestForwardDeployEvents_ForwardsEachEventOnceAndAgainWhenItRepeats(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	event := podEvent("srl1-pod.1", "srl1-pod", "Unhealthy", "Readiness probe failed", now)
	cluster := newFakeCluster(t, []runtime.Object{event}, nil)
	logs := &logCollector{}
	sent := map[string]int32{}

	cluster.provider.forwardDeployEvents(context.Background(), fakeNamespace, now, sent, logs.log)
	cluster.provider.forwardDeployEvents(context.Background(), fakeNamespace, now, sent, logs.log)
	require.Len(t, logs.all(), 1, "an unchanged event must not be forwarded twice")

	event.Count = 25
	_, err := cluster.k8s.CoreV1().Events(fakeNamespace).Update(context.Background(), event, metav1.UpdateOptions{})
	require.NoError(t, err)

	cluster.provider.forwardDeployEvents(context.Background(), fakeNamespace, now, sent, logs.log)

	lines := logs.all()
	require.Len(t, lines, 2)
	assert.Contains(t, lines[1], "count=25")
}

/*
 * inspect
 */

func TestInspect_ReportsRunningStoppedAndStoppingNodes(t *testing.T) {
	terminating := nodePod("old-a1", "a1", corev1.PodRunning, true)
	terminating.DeletionTimestamp = &metav1.Time{Time: time.Now()}
	terminating.Finalizers = []string{"test"} // keeps the tracker from rejecting a deletion timestamp

	cluster := newFakeCluster(t, []runtime.Object{
		nodePod("a1-pod", "a1", corev1.PodRunning, true),
		terminating,
		nodeDeployment("a1", 1),
		nodeDeployment("a2", 0),
		nodeDeployment("a3", 0),
		nodePod("a3-pod", "a3", corev1.PodRunning, true),
		nodePod("a4-pod", "a4", corev1.PodPending, false),
		nodeDeployment("a4", 1),
	}, nil)

	labs, err := cluster.provider.InspectLabs(context.Background(), (&logCollector{}).log)
	require.NoError(t, err)

	states := map[string]NodeState{}
	for _, container := range labs["demo"] {
		states[container.Name] = container.State
	}

	assert.Equal(t, map[string]NodeState{
		"a1": NodeStates.Running,  // the terminating pod of a restart is ignored
		"a2": NodeStates.Stopped,  // scaled to zero, no pod left
		"a3": NodeStates.Stopping, // scaled to zero, pod still winding down
		"a4": NodeStates.Starting,
	}, states)
}

func TestInspectLab_ReportsALabWithoutPodsAsNotRunning(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)

	_, err := cluster.provider.InspectLab(context.Background(), "", "demo", (&logCollector{}).log)

	assert.ErrorIs(t, err, utils.ErrLabNotRunning)
}

func TestInspectNode_ReportsAnUnknownNode(t *testing.T) {
	cluster := newFakeCluster(t, []runtime.Object{nodePod("a1-pod", "a1", corev1.PodRunning, true)}, nil)

	_, err := cluster.provider.InspectNode(context.Background(), "", "demo", "missing", (&logCollector{}).log)

	assert.ErrorIs(t, err, utils.ErrNodeNotFound)
}

/*
 * podForNode
 */

func TestPodForNode_FindsThePodWithARunningDevice(t *testing.T) {
	cluster := newFakeCluster(t, []runtime.Object{nodePod("a1-pod", "a1", corev1.PodRunning, false)}, nil)

	pod, err := cluster.provider.podForNode(context.Background(), fakeNamespace, "a1")

	require.NoError(t, err)
	assert.Equal(t, "a1-pod", pod.Name, "the device runs before c9s reports the pod ready")
}

func TestPodForNode_ReportsANodeWithoutARunningDeviceAsNotRunning(t *testing.T) {
	waiting := nodePod("a1-pod", "a1", corev1.PodRunning, false)
	waiting.Status.ContainerStatuses[0].State = corev1.ContainerState{
		Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"},
	}

	terminating := nodePod("a2-pod", "a2", corev1.PodRunning, true)
	terminating.DeletionTimestamp = &metav1.Time{Time: time.Now()}
	terminating.Finalizers = []string{"test"}

	cases := map[string]runtime.Object{
		"device crash-looping": waiting,
		"pod terminating":      terminating,
		"pod pending":          nodePod("a3-pod", "a3", corev1.PodPending, false),
	}
	nodes := map[string]string{"device crash-looping": "a1", "pod terminating": "a2", "pod pending": "a3"}

	for name, pod := range cases {
		t.Run(name, func(t *testing.T) {
			cluster := newFakeCluster(t, []runtime.Object{pod}, nil)

			_, err := cluster.provider.podForNode(context.Background(), fakeNamespace, nodes[name])

			assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
		})
	}
}

func TestPodForNode_ReportsAStoppedNodeAsNotRunning(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)

	_, err := cluster.provider.podForNode(context.Background(), fakeNamespace, "a1")

	assert.ErrorIs(t, err, utils.ErrNodeNotRunning)
}

/*
 * StopNode / StartNode / RestartNode
 */

func getReplicas(t *testing.T, cluster *fakeCluster, node string) int32 {
	t.Helper()

	deployment, err := cluster.k8s.AppsV1().
		Deployments(fakeNamespace).
		Get(context.Background(), node, metav1.GetOptions{})
	require.NoError(t, err)

	return *deployment.Spec.Replicas
}

func getNodeLabels(t *testing.T, cluster *fakeCluster, node string) map[string]string {
	t.Helper()

	n, err := cluster.c9s.C9sV1alpha1().Nodes(fakeNamespace).Get(context.Background(), node, metav1.GetOptions{})
	require.NoError(t, err)

	return n.Labels
}

func TestStopNode_ScalesTheNodeDownAndKeepsTheManagerFromRevertingIt(t *testing.T) {
	cluster := newFakeCluster(t, []runtime.Object{nodeDeployment("a1", 1)}, []runtime.Object{c9sNode("a1")})

	require.NoError(t, cluster.provider.StopNode(context.Background(), "demo", "a1"))

	assert.Equal(t, int32(0), getReplicas(t, cluster, "a1"))
	assert.Equal(t, "true", getNodeLabels(t, cluster, "a1")[clabernetesconstants.LabelIgnoreReconcile])
}

func TestStartNode_HandsTheNodeBackToTheManagerAndScalesItUp(t *testing.T) {
	stopped := c9sNode("a1")
	stopped.Labels = map[string]string{clabernetesconstants.LabelIgnoreReconcile: "true", "keep": "me"}
	cluster := newFakeCluster(t, []runtime.Object{nodeDeployment("a1", 0)}, []runtime.Object{stopped})

	require.NoError(t, cluster.provider.StartNode(context.Background(), "demo", "a1"))

	assert.Equal(t, int32(1), getReplicas(t, cluster, "a1"))
	assert.Equal(t, map[string]string{"keep": "me"}, getNodeLabels(t, cluster, "a1"))
}

func TestStopNode_FailsForAnUnknownNode(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)

	err := cluster.provider.StopNode(context.Background(), "demo", "missing")

	assert.True(t, apierrors.IsNotFound(err))
}

// deleteCollectionOf returns the DeleteCollection call the provider made on pods.
func deleteCollectionOf(t *testing.T, cluster *fakeCluster) k8stesting.DeleteCollectionActionImpl {
	t.Helper()

	for _, action := range cluster.k8s.Actions() {
		if deletion, ok := action.(k8stesting.DeleteCollectionActionImpl); ok &&
			deletion.GetResource().Resource == "pods" {
			return deletion
		}
	}

	require.Fail(t, "no pods were deleted")
	return k8stesting.DeleteCollectionActionImpl{}
}

func TestRestartNode_DeletesOnlyTheNodesPodsGracefully(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)

	require.NoError(t, cluster.provider.RestartNode(context.Background(), "demo", "a1"))

	deletion := deleteCollectionOf(t, cluster)
	assert.Equal(t, fakeNamespace, deletion.GetNamespace())
	assert.Equal(t, clabernetesconstants.LabelTopologyNode+"=a1", deletion.GetListRestrictions().Labels.String())
	assert.Equal(t, int64(10), *deletion.DeleteOptions.GracePeriodSeconds)
}

/*
 * Destroy
 */

func TestDestroy_KillsTheNodePodsAndRemovesTheNamespace(t *testing.T) {
	cluster := newFakeCluster(t, []runtime.Object{
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: fakeNamespace}},
		nodePod("a1-pod", "a1", corev1.PodRunning, true),
	}, nil)
	logs := &logCollector{}

	require.NoError(t, cluster.provider.Destroy(context.Background(), "", "demo", logs.log))

	deletion := deleteCollectionOf(t, cluster)
	assert.Equal(t, clabernetesconstants.LabelTopologyNode, deletion.GetListRestrictions().Labels.String())
	assert.Equal(t, int64(0), *deletion.DeleteOptions.GracePeriodSeconds)

	_, err := cluster.k8s.CoreV1().Namespaces().Get(context.Background(), fakeNamespace, metav1.GetOptions{})
	assert.True(t, apierrors.IsNotFound(err))
	assert.NotEmpty(t, linesContaining(logs, "Deletion of namespace succeeded"))
}

func TestDestroy_SucceedsForAnAlreadyRemovedLab(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)
	logs := &logCollector{}

	require.NoError(t, cluster.provider.Destroy(context.Background(), "", "demo", logs.log))

	assert.NotEmpty(t, linesContaining(logs, "already been removed"))
}

/*
 * RegisterListener
 */

// startListener runs RegisterListener until the test ends and returns the node names it reported.
func startListener(t *testing.T, cluster *fakeCluster) func() []string {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	updates := &logCollector{}
	go func() { _ = cluster.provider.RegisterListener(ctx, updates.log) }()

	return updates.all
}

func TestRegisterListener_ReportsNodePodsAppearing(t *testing.T) {
	cluster := newFakeCluster(t, nil, nil)
	updates := startListener(t, cluster)

	// Created after the listener started, so this is a live event and not part of the initial sync.
	require.Eventually(t, func() bool {
		_, err := cluster.k8s.CoreV1().Pods(fakeNamespace).Create(
			context.Background(), nodePod("a1-pod", "a1", corev1.PodPending, false), metav1.CreateOptions{},
		)
		return err == nil
	}, time.Second, 10*time.Millisecond)

	assert.Eventually(t, func() bool { return slices.Contains(updates(), "a1") }, 2*time.Second, 10*time.Millisecond)
}

func TestRegisterListener_ReportsPodUpdatesOnlyWhenTheNodeStateChanges(t *testing.T) {
	pod := nodePod("a1-pod", "a1", corev1.PodRunning, false)
	cluster := newFakeCluster(t, []runtime.Object{pod}, nil)
	updates := startListener(t, cluster)

	// The initial sync reports the existing pod as an add.
	require.Eventually(t, func() bool { return len(updates()) == 1 }, 2*time.Second, 10*time.Millisecond)

	// An update that leaves the node starting must not be reported...
	pod.Labels["unrelated"] = "change"
	_, err := cluster.k8s.CoreV1().Pods(fakeNamespace).Update(context.Background(), pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	// ...but the pod becoming ready, e.g. after a restart, must be. Informer events arrive in order,
	// so a report of the first update would show up before this one.
	pod.Status.Conditions[0].Status = corev1.ConditionTrue
	_, err = cluster.k8s.CoreV1().Pods(fakeNamespace).UpdateStatus(context.Background(), pod, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.Eventually(t, func() bool { return len(updates()) >= 2 }, 2*time.Second, 10*time.Millisecond)
	assert.Equal(t, []string{"a1", "a1"}, updates())
}

func TestRegisterListener_ReportsNodesBeingScaled(t *testing.T) {
	cluster := newFakeCluster(t, []runtime.Object{nodeDeployment("a1", 1)}, []runtime.Object{c9sNode("a1")})
	updates := startListener(t, cluster)

	// Give the informers time to sync, scaling before that would be part of the initial list.
	time.Sleep(200 * time.Millisecond)
	require.NoError(t, cluster.provider.StopNode(context.Background(), "demo", "a1"))

	assert.Eventually(t, func() bool { return slices.Contains(updates(), "a1") }, 2*time.Second, 10*time.Millisecond)
}

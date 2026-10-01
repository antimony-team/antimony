package deployment

import (
	"antimonyBackend/utils"
	"antimonyBackend/utils/serverlog"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	c9sv1alpha1 "github.com/clabernetes/clabernetes/apis/v1alpha1"
	clabernetesconstants "github.com/clabernetes/clabernetes/constants"
	c9sclientset "github.com/clabernetes/clabernetes/generated/clientset"
	"github.com/google/gopacket/afpacket"
	"github.com/samber/lo"
	"gopkg.in/yaml.v3"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/transport/spdy"
	k8sexec "k8s.io/client-go/util/exec"

	corev1 "k8s.io/api/core/v1"
)

type ClabernetesProvider struct {
	restConfig *rest.Config
	clientset  *kubernetes.Clientset
	c9s        *c9sclientset.Clientset

	statsReader *StatsReader[podRef]
}

func CreateClabernetesProvider() *ClabernetesProvider {
	cfg, err := loadKubeConfig("")
	if err != nil {
		log.Fatalf("Failed to create clabernetes client: %s", err.Error())
		return nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		log.Fatalf("Failed to create clabernetes client: %s", err.Error())
		return nil
	}

	c9s, err := c9sclientset.NewForConfig(cfg)
	if err != nil {
		log.Fatalf("Failed to create clabernetes client: %s", err.Error())
		return nil
	}

	provider := &ClabernetesProvider{
		restConfig: cfg,
		clientset:  cs,
		c9s:        c9s,
	}

	provider.statsReader = CreateStatsReader[podRef](createRemoteSampler(provider.startExecStream))

	return provider
}

func (p *ClabernetesProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	namespace := namespaceFor(instanceName)

	content, err := os.ReadFile(topologyFile)
	if err != nil {
		return fmt.Errorf("read topology %s: %w", topologyFile, err)
	}

	definition, err := stripTopologyLabels(content)
	if err != nil {
		return fmt.Errorf("parse topology %s: %w", topologyFile, err)
	}

	onLog.Log(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Creating clabernetes topology",
		"instance", instanceName,
		"namespace", namespace,
	))

	if err := p.applyTopology(ctx, namespace, instanceName, definition); err != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Creation of clabernetes topology failed",
			"instance", instanceName,
			"namespace", namespace,
			"err", err.Error(),
		))

		return err
	}

	onLog.Log(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Waiting for kubernetes deployment to complete",
		"instance", instanceName,
		"namespace", namespace,
	))

	return p.waitForTopologyReady(ctx, namespace, instanceName, onLog)
}

func (p *ClabernetesProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	if err := p.Destroy(ctx, topologyFile, instanceName, onLog); err != nil {
		return err
	}

	return p.Deploy(ctx, topologyFile, instanceName, onLog)
}

func (p *ClabernetesProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	namespace := namespaceFor(instanceName)

	pods, err := p.clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: clabernetesconstants.LabelTopologyNode,
	})
	if err != nil && !apierrors.IsNotFound(err) {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to fetch pods in namespace",
			"err", err.Error(),
		))
		return err
	}

	if pods != nil {
		for _, pod := range pods.Items {
			onLog.Log(serverlog.CreateAntimonyLog(
				serverlog.InfoLevel,
				"Stopping node",
				"namespace", namespace,
				"node", pod.Labels[clabernetesconstants.LabelTopologyNode],
				"name", pod.Name,
			))
		}
	}

	// Kill the node pods right away instead of waiting out their grace period.
	zero := int64(0)
	err = p.clientset.CoreV1().Pods(namespace).DeleteCollection(
		ctx,
		metav1.DeleteOptions{GracePeriodSeconds: &zero},
		metav1.ListOptions{LabelSelector: clabernetesconstants.LabelTopologyNode},
	)
	if err != nil && !apierrors.IsNotFound(err) {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to fetch collection in namespace",
			"err", err.Error(),
		))
		return err
	}

	onLog.Log(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Deleting namespace",
		"namespace", namespace,
	))

	if err := p.clientset.CoreV1().
		Namespaces().
		Delete(ctx, namespace, metav1.DeleteOptions{GracePeriodSeconds: &zero}); err != nil {
		if apierrors.IsNotFound(err) {
			// The namespace has already been destroyed
			onLog.Log(serverlog.CreateAntimonyLog(
				serverlog.WarningLevel,
				"The namespace has already been removed",
				"namespace", namespace,
			))
			return nil
		}

		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Deletion of namespace failed",
			"namespace", namespace,
			"err", err.Error(),
		))
		return err
	}

	onLog.Log(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Waiting for namespace to be removed",
		"namespace", namespace,
	))

	return p.waitForNamespaceGone(ctx, namespace, onLog)
}

func (p *ClabernetesProvider) InspectLabs(
	ctx context.Context,
	onLog LogFunc,
) (map[string][]InspectContainer, error) {
	return p.inspect(ctx, "", metav1.NamespaceAll)
}

func (p *ClabernetesProvider) InspectLab(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) ([]InspectContainer, error) {
	inspectOutput, err := p.inspect(ctx, topologyFile, metav1.NamespaceAll)
	if err != nil {
		return nil, err
	}

	if labInspect, ok := inspectOutput[instanceName]; !ok {
		return nil, utils.ErrLabNotRunning
	} else {
		return labInspect, nil
	}
}

func (p *ClabernetesProvider) InspectNode(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	nodeName string,
	onLog LogFunc,
) (InspectContainer, error) {
	inspectOutput, err := p.inspect(ctx, topologyFile, metav1.NamespaceAll)
	if err != nil {
		return InspectContainer{}, err
	}

	labInspect, ok := inspectOutput[instanceName]
	if !ok {
		return InspectContainer{}, utils.ErrLabNotRunning
	}

	nodeInspect, ok := lo.Find(labInspect, func(i InspectContainer) bool {
		return i.Name == nodeName
	})

	if !ok {
		return InspectContainer{}, utils.ErrNodeNotFound
	}

	return nodeInspect, nil
}

// containerRef locates an already-appended container in the inspect output, so a pod that is still
// winding down can update the entry its deployment created.
type containerRef struct {
	labName string
	index   int
}

// inspect lists the running node pods in ns (all namespaces when empty) and
// appends an "exited" entry for every node deployment scaled to zero, since
// stopped nodes have no pod.
func (p *ClabernetesProvider) inspect(
	ctx context.Context,
	topologyFile string,
	namespace string,
) (map[string][]InspectContainer, error) {
	selector := metav1.ListOptions{LabelSelector: clabernetesconstants.LabelTopologyNode}

	pods, err := p.clientset.CoreV1().Pods(namespace).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node pods: %w", err)
	}

	deployments, err := p.clientset.AppsV1().Deployments(namespace).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node deployments: %w", err)
	}

	output := make(map[string][]InspectContainer)
	stoppedIdx := make(map[string]containerRef)

	for i := range deployments.Items {
		d := &deployments.Items[i]
		if d.Spec.Replicas == nil || *d.Spec.Replicas != 0 {
			continue // has (or will have) a pod: already covered above
		}
		c := stoppedDeploymentToInspectContainer(d, topologyFile)
		output[c.LabName] = append(output[c.LabName], c)
		stoppedIdx[d.Namespace+"/"+c.Name] = containerRef{
			labName: c.LabName,
			index:   len(output[c.LabName]) - 1,
		}
	}

	for i := range pods.Items {
		pod := &pods.Items[i]
		node := pod.Labels[clabernetesconstants.LabelTopologyNode]

		if ref, ok := stoppedIdx[pod.Namespace+"/"+node]; ok {
			// Pod is scaling down to 0, still winding down
			output[ref.labName][ref.index].State = NodeStates.Stopping
			continue
		}

		if pod.DeletionTimestamp != nil {
			// This pod is being replaced by a restart, the new pod carries the state
			continue
		}
		c := podToInspectContainer(pod, topologyFile)
		output[c.LabName] = append(output[c.LabName], c)
	}

	return output, nil
}

func podToInspectContainer(pod *corev1.Pod, topologyFile string) InspectContainer {
	container := InspectContainer{
		Name:          pod.Labels[clabernetesconstants.LabelTopologyNode],
		LabName:       pod.Labels[clabernetesconstants.LabelTopologyOwner],
		LabPath:       topologyFile,
		ContainerId:   string(pod.UID),
		ContainerName: pod.Name,
		State:         podStateToNodeState(pod),
	}

	if spec := pod.Spec.Containers; len(pod.Spec.Containers) > 0 {
		container.Image = spec[0].Image
	}

	for _, ip := range pod.Status.PodIPs {
		if strings.Contains(ip.IP, ":") {
			container.IPv6Address = ip.IP
		} else {
			container.IPv4Address = ip.IP
		}
	}

	return container
}

func stoppedDeploymentToInspectContainer(d *appsv1.Deployment, topologyFile string) InspectContainer {
	container := InspectContainer{
		Name:          d.Labels[clabernetesconstants.LabelTopologyNode],
		LabName:       d.Labels[clabernetesconstants.LabelTopologyOwner],
		LabPath:       topologyFile,
		ContainerId:   "",
		ContainerName: "",
		State:         NodeStates.Stopped,
	}

	if spec := d.Spec.Template.Spec.Containers; len(spec) > 0 {
		container.Image = spec[0].Image
	}

	return container
}

// podStateToNodeState maps a live (non-terminating) pod's phase onto the runtime state of the node it backs.
// Terminating pods are handled by the caller, since whether they mean "stopping" or "restarting" depends on the
// deployment, not the pod.
func podStateToNodeState(pod *corev1.Pod) NodeState {
	switch pod.Status.Phase {
	case corev1.PodSucceeded, corev1.PodFailed:
		return NodeStates.Stopped
	case corev1.PodRunning:
		for _, c := range pod.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
				return NodeStates.Running
			}
		}
		return NodeStates.Starting
	case corev1.PodPending:
		return NodeStates.Starting
	default:
		return NodeStates.Starting
	}
}

func (p *ClabernetesProvider) Exec(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (string, int, error) {
	namespace := namespaceFor(instanceName)
	pod, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return "", 0, err
	}

	executor, err := p.createExec(namespace, pod, cmd, false)
	if err != nil {
		return "", 0, err
	}

	var stdout, stderr bytes.Buffer
	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	})

	output := stdout.String()
	if stderr.Len() > 0 {
		output += stderr.String()
	}

	var codeErr k8sexec.CodeExitError
	if errors.As(err, &codeErr) {
		return output, codeErr.Code, nil
	}

	// Unlike docker exec, the container runtime reports a missing executable as an error instead of
	// a shell's "command not found" exit code.
	if err != nil && strings.Contains(err.Error(), "executable file not found") {
		return output, commandNotFoundExitCode, nil
	}
	return output, 0, err
}

// commandNotFoundExitCode is the exit code a shell returns for an unknown command.
const commandNotFoundExitCode = 127

func (p *ClabernetesProvider) ExecInteractive(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (ShellExecSession, error) {
	namespace := namespaceFor(instanceName)
	pod, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return nil, err
	}

	executor, err := p.createExec(namespace, pod, cmd, true)
	if err != nil {
		return nil, err
	}

	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()

	ctx, cancel := context.WithCancel(ctx)
	session := &kubernetesExecSession{
		Reader: stdoutR,
		stdinW: stdinW,
		sizes:  createSizeQueue(),
		cancel: cancel,
	}

	go func() {
		err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdin:             stdinR,
			Stdout:            stdoutW,
			Tty:               true,
			TerminalSizeQueue: session.sizes,
		})

		var codeErr k8sexec.CodeExitError
		if errors.As(err, &codeErr) {
			err = nil // shell exited on its own; that's a clean EOF
		}

		_ = stdoutW.CloseWithError(err)
	}()

	return session, nil
}

// DialNode opens a TCP connection to port on the node through a pods/portforward stream.
// The device container shares the pod's network namespace, so the port is the device's own.
func (p *ClabernetesProvider) DialNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
	port int,
) (net.Conn, error) {
	namespace := namespaceFor(instanceName)
	pod, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return nil, err
	}

	transport, upgrader, err := spdy.RoundTripperFor(p.restConfig)
	if err != nil {
		return nil, err
	}

	req := p.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod.Name).
		SubResource("portforward")

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, "POST", req.URL())
	streamConn, _, err := dialer.Dial(portforward.PortForwardProtocolV1Name)
	if err != nil {
		return nil, fmt.Errorf("port-forward to %s/%s: %w", namespace, pod.Name, err)
	}

	headers := http.Header{}
	headers.Set(corev1.StreamType, corev1.StreamTypeError)
	headers.Set(corev1.PortHeader, strconv.Itoa(port))
	headers.Set(corev1.PortForwardRequestIDHeader, "0")

	errorStream, err := streamConn.CreateStream(headers)
	if err != nil {
		_ = streamConn.Close()
		return nil, err
	}
	// The error stream is read-only for the client
	_ = errorStream.Close()

	headers.Set(corev1.StreamType, corev1.StreamTypeData)
	dataStream, err := streamConn.CreateStream(headers)
	if err != nil {
		_ = streamConn.Close()
		return nil, err
	}

	local, remote := net.Pipe()
	closeAll := sync.OnceFunc(func() {
		_ = remote.Close()
		_ = streamConn.Close()
	})

	go func() {
		defer closeAll()
		_, _ = io.Copy(remote, dataStream)
	}()
	go func() {
		defer closeAll()
		_, _ = io.Copy(dataStream, remote)
	}()
	go func() {
		// The kubelet reports failures such as a refused connection on the error stream
		if msg, _ := io.ReadAll(errorStream); len(msg) > 0 {
			closeAll()
		}
	}()
	go func() {
		select {
		case <-ctx.Done():
		case <-streamConn.CloseChan():
		}
		closeAll()
	}()

	return local, nil
}

// OpenCapture is not supported on clabernetes.
//
// Capturing relies on attaching an AF_PACKET socket to an interface in the node's network
// namespace, which the server cannot reach when the node runs in a pod on another host.
func (p *ClabernetesProvider) OpenCapture(
	_ context.Context,
	_ string,
	_ string,
	_ string,
) (*afpacket.TPacket, error) {
	return nil, utils.ErrCaptureNotSupported
}

func (p *ClabernetesProvider) StartNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	namespace := namespaceFor(instanceName)
	if err := p.setIgnoreReconcile(ctx, namespace, nodeName, false); err != nil {
		return err
	}
	return p.scaleNode(ctx, namespace, nodeName, 1)
}

func (p *ClabernetesProvider) StopNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	namespace := namespaceFor(instanceName)
	if err := p.setIgnoreReconcile(ctx, namespace, nodeName, true); err != nil {
		return err
	}
	return p.scaleNode(ctx, namespace, nodeName, 0)
}

func (p *ClabernetesProvider) RestartNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	namespace := namespaceFor(instanceName)
	grace := int64(10)

	return p.clientset.CoreV1().Pods(namespace).DeleteCollection(ctx,
		metav1.DeleteOptions{GracePeriodSeconds: &grace},
		metav1.ListOptions{LabelSelector: clabernetesconstants.LabelTopologyNode + "=" + nodeName},
	)
}

func (p *ClabernetesProvider) RegisterListener(
	ctx context.Context,
	onUpdate func(nodeName string),
) error {
	factory := informers.NewSharedInformerFactoryWithOptions(
		p.clientset,
		0, // no periodic resync; events only
		informers.WithTweakListOptions(func(o *metav1.ListOptions) {
			o.LabelSelector = clabernetesconstants.LabelTopologyNode
		}),
	)

	podFromEvent := func(obj any) *corev1.Pod {
		switch t := obj.(type) {
		case *corev1.Pod:
			return t
		case cache.DeletedFinalStateUnknown:
			if pod, ok := t.Obj.(*corev1.Pod); ok {
				return pod
			}
		}
		return nil
	}

	notify := func(pod *corev1.Pod) {
		if pod == nil {
			return
		}
		onUpdate(pod.Labels[clabernetesconstants.LabelTopologyNode])
	}

	_, err := factory.Core().V1().Pods().Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj any) { notify(podFromEvent(obj)) },
		DeleteFunc: func(obj any) { notify(podFromEvent(obj)) },
		// Readiness changes arrive as updates, e.g. a restarted node's new pod becoming ready.
		UpdateFunc: func(oldObj, newObj any) {
			o, n := podFromEvent(oldObj), podFromEvent(newObj)
			if o == nil || n == nil {
				return
			}

			terminationChanged := (o.DeletionTimestamp == nil) != (n.DeletionTimestamp == nil)
			if terminationChanged || podStateToNodeState(o) != podStateToNodeState(n) {
				notify(n)
			}
		},
	})

	if err != nil {
		return err
	}

	// Deployments carry the stop/start state (replicas 0/1); a stopped node has no pod to watch.
	_, err = factory.Apps().V1().Deployments().Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		UpdateFunc: func(oldObj, newObj any) {
			// An informer can hand over a cache.DeletedFinalStateUnknown tombstone instead of the
			// object, so neither assertion is guaranteed to hold.
			o, isOldDeployment := oldObj.(*appsv1.Deployment)
			n, isNewDeployment := newObj.(*appsv1.Deployment)

			if !isOldDeployment || !isNewDeployment {
				return
			}

			if replicas(o) != replicas(n) {
				onUpdate(n.Name)
			}
		},
	})
	if err != nil {
		return err
	}

	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())
	<-ctx.Done()
	return nil
}

func replicas(d *appsv1.Deployment) int32 {
	if d.Spec.Replicas == nil {
		return 1
	}
	return *d.Spec.Replicas
}

func (p *ClabernetesProvider) ReadNodeStats(
	ctx context.Context,
	instanceName string,
	nodeName string,
) (*NodeStats, error) {
	namespace := namespaceFor(instanceName)
	nodeId := namespace + "/" + nodeName

	return p.statsReader.Read(ctx, nodeId, podRef{instanceName, nodeName})
}

func (p *ClabernetesProvider) StreamContainerLogs(
	ctx context.Context,
	instanceName string,
	nodeName string,
	onLog LogFunc,
) error {
	namespace := namespaceFor(instanceName)
	pod, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return err
	}

	// The pod log only holds the device's own output. Startup progress such as image pulls, failed exec commands
	// or planning problems is recorded as events on the pod and the c9s Node, so those go first.
	p.sendNodeEvents(ctx, namespace, nodeName, pod.Name, onLog)

	// Kubernetes prepends an RFC 3339 timestamp per line.
	stream, err := p.clientset.CoreV1().
		Pods(namespace).
		GetLogs(pod.Name, &corev1.PodLogOptions{
			Follow:     true,
			Timestamps: true,
		}).
		Stream(ctx)
	if err != nil {
		return err
	}

	onLogWrapper := func(msg string) {
		onLog.Log(serverlog.ReplaceAnsiCharacters(msg))
	}

	go func() {
		defer stream.Close()
		streamOutput(stream, onLogWrapper)
	}()

	return nil
}

// sendNodeEvents sends the events recorded for a node's pod and its c9s Node, oldest first. The lines use the
// pod log's "<RFC 3339 timestamp> <message>" format.
func (p *ClabernetesProvider) sendNodeEvents(
	ctx context.Context,
	namespace string,
	nodeName string,
	podName string,
	onLog LogFunc,
) {
	var events []corev1.Event
	for kind, name := range map[string]string{"Pod": podName, "Node": nodeName} {
		list, err := p.clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
			FieldSelector: fields.Set{"involvedObject.kind": kind, "involvedObject.name": name}.String(),
		})
		if err != nil {
			log.Warn("Failed to list node events", "namespace", namespace, "kind", kind, "name", name, "err", err)
			continue
		}
		events = append(events, list.Items...)
	}

	// Most events only have second precision. Their names end in a nanosecond creation timestamp, which orders
	// events of the same object within a second.
	slices.SortFunc(events, func(a, b corev1.Event) int {
		if c := eventTime(a).Compare(eventTime(b)); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})

	for _, event := range events {
		label := "Event"
		if event.Type == corev1.EventTypeWarning {
			label = "Warning"
		}

		line := fmt.Sprintf(
			"%s [%s %s] %s",
			eventTime(event).UTC().Format(time.RFC3339Nano), label, event.Reason, event.Message,
		)
		if event.Count > 1 {
			line += fmt.Sprintf(" (x%d)", event.Count)
		}
		onLog.Log(line)
	}
}

// eventTime returns when an event last occurred. Depending on the reporter, events carry either the legacy
// timestamps or EventTime.
func eventTime(event corev1.Event) time.Time {
	switch {
	case !event.LastTimestamp.IsZero():
		return event.LastTimestamp.Time
	case !event.EventTime.IsZero():
		return event.EventTime.Time
	default:
		return event.CreationTimestamp.Time
	}
}

func (p *ClabernetesProvider) GetNetworkInterfaces(
	ctx context.Context,
	instanceName string,
	nodeName string,
) ([]NodeInterface, error) {
	namespace := namespaceFor(instanceName)

	listInterfacesScript := `for d in /sys/class/net/*; do
	  n=${d##*/}; [ "$n" = lo ] && continue
	  echo "$n $(cat $d/address 2>/dev/null) $(cat $d/mtu 2>/dev/null) $(cat $d/operstate 2>/dev/null)"
	done`

	out, code, err := p.Exec(
		ctx,
		instanceName,
		nodeName,
		[]string{"sh", "-c", listInterfacesScript},
	)

	if err != nil {
		if errors.Is(err, utils.ErrNodeNotRunning) {
			return nil, utils.ErrNodeNotRunning
		}

		return nil, fmt.Errorf("list interfaces in %s/%s: %w", namespace, nodeName, err)
	}

	if code != 0 {
		return nil, fmt.Errorf("list interfaces of %s: exit code %d: %s", nodeName, code, strings.TrimSpace(out))
	}

	result := make([]NodeInterface, 0)

	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		mtu, _ := strconv.Atoi(fields[2])
		result = append(result, NodeInterface{
			Name:    fields[0],
			Address: fields[1],
			MTU:     mtu,
			State:   fields[3],
		})
	}

	return result, nil
}

// startExecStream runs cmd inside the node and copies its stdout to w until ctx is
// canceled or the command exits. Unlike Exec, it does not collect output or
// an exit code; it is meant for long-running commands that emit continuously.
func (p *ClabernetesProvider) startExecStream(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
	w io.Writer,
) error {
	namespace := namespaceFor(instanceName)
	pod, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return err
	}

	executor, err := p.createExec(namespace, pod, cmd, false)
	if err != nil {
		return err
	}

	return executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: w,
		Stderr: io.Discard,
	})
}

// waitForTopologyReady is used by the Deploy function to wait until all nodes in a lab are deployed and ready.
func (p *ClabernetesProvider) waitForTopologyReady(
	ctx context.Context,
	namespace string,
	instanceName string,
	onLog LogFunc,
) error {
	lastReady := -1

	return wait.PollUntilContextTimeout(ctx, time.Second, 10*time.Minute, true,
		func(ctx context.Context) (bool, error) {
			topo, err := p.c9s.C9sV1alpha1().Topologies(namespace).Get(ctx, instanceName, metav1.GetOptions{})
			if err != nil {
				return false, err
			}
			st := topo.Status

			if st.ReadyNodeCount != lastReady {
				onLog.Log(serverlog.CreateAntimonyLog(
					serverlog.InfoLevel,
					fmt.Sprintf("Deployment status: %d/%d nodes ready", st.ReadyNodeCount, st.NodeCount),
					"instance", instanceName,
					"namespace", namespace,
				))
				lastReady = st.ReadyNodeCount
			}

			switch st.TopologyState {
			case c9sv1alpha1.TopologyStateDeployFailed:
				return false, fmt.Errorf("deployment of %s failed: %s", instanceName, conditionSummary(st.Conditions))
			case c9sv1alpha1.TopologyStateRunning:
				return true, nil
			}
			return st.TopologyReady && st.NodeCount > 0, nil
		},
	)
}

func (p *ClabernetesProvider) waitForNamespaceGone(
	ctx context.Context,
	namespace string,
	onLog LogFunc,
) error {
	return wait.PollUntilContextTimeout(ctx, time.Second, 2*time.Minute, true,
		func(ctx context.Context) (bool, error) {
			_, err := p.clientset.CoreV1().Namespaces().Get(ctx, namespace, metav1.GetOptions{})
			if apierrors.IsNotFound(err) {
				onLog.Log(serverlog.CreateAntimonyLog(
					serverlog.SuccessLevel,
					"Deletion of namespace succeeded",
					"namespace", namespace,
				))

				return true, nil
			}

			if err != nil {
				onLog.Log(serverlog.CreateAntimonyLog(
					serverlog.ErrorLevel,
					"Waiting for namespace deletion has failed",
					"namespace", namespace,
					"err", err.Error(),
				))
			}
			return false, err
		},
	)
}

// createExec prepares a pods/exec request for cmd inside the node's device container.
func (p *ClabernetesProvider) createExec(
	namespace string,
	pod *corev1.Pod,
	cmd []string,
	tty bool,
) (remotecommand.Executor, error) {
	req := p.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod.Name).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: deviceContainer(pod),
			Command:   cmd,
			Stdin:     tty,
			Stdout:    true,
			Stderr:    !tty, // merged into stdout when a TTY is allocated
			TTY:       tty,
		}, scheme.ParameterCodec)

	return remotecommand.NewSPDYExecutor(p.restConfig, "POST", req.URL())
}

// podForNode returns the pod currently backing a node. It returns ErrNodeNotRunning when the node has no
// pod with a running device container: stopped, started but not created yet, or the device is restarting.
func (p *ClabernetesProvider) podForNode(ctx context.Context, namespace, nodeName string) (*corev1.Pod, error) {
	pods, err := p.clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: clabernetesconstants.LabelTopologyNode + "=" + nodeName,
	})
	if err != nil {
		return nil, err
	}

	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.DeletionTimestamp != nil || pod.Status.Phase != corev1.PodRunning {
			continue
		}

		container := deviceContainer(pod)
		for _, status := range pod.Status.ContainerStatuses {
			if status.Name == container && status.State.Running != nil {
				return pod, nil
			}
		}
	}
	return nil, utils.ErrNodeNotRunning
}

// defaultContainerAnnotation names the container kubectl targets by default. c9s sets it to the device container.
const defaultContainerAnnotation = "kubectl.kubernetes.io/default-container"

// deviceContainer returns the name of the device container in a node pod. Besides the device, the pod runs c9s's
// own init and sidecar containers, and chassis or grouped nodes run more than one device container.
func deviceContainer(pod *corev1.Pod) string {
	if name := pod.Annotations[defaultContainerAnnotation]; name != "" {
		return name
	}
	if len(pod.Spec.Containers) > 0 {
		return pod.Spec.Containers[0].Name
	}
	return ""
}

// conditionSummary flattens the False conditions into one line for an error.
func conditionSummary(conds []metav1.Condition) string {
	var parts []string
	for _, c := range conds {
		if c.Status == metav1.ConditionFalse && c.Message != "" {
			parts = append(parts, c.Type+": "+c.Message)
		}
	}
	if len(parts) == 0 {
		return "see topology status"
	}
	return strings.Join(parts, "; ")
}

func loadKubeConfig(path string) (*rest.Config, error) {
	if path == "" {
		if cfg, err := rest.InClusterConfig(); err == nil {
			return cfg, nil
		}
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	if path != "" {
		rules.ExplicitPath = path
	}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		rules, &clientcmd.ConfigOverrides{},
	).ClientConfig()
}

func namespaceFor(topologyName string) string {
	return "c9s-" + topologyName
}

// stripTopologyLabels removes all containerlab labels from a topology definition. Clabernetes turns them into
// Kubernetes labels and rejects the whole topology if a value isn't a valid label value (e.g. a negative graph
// position). They only carry Antimony's UI metadata, which nothing reads from the cluster.
func stripTopologyLabels(content []byte) (string, error) {
	var definition map[string]any
	if err := yaml.Unmarshal(content, &definition); err != nil {
		return "", err
	}

	if topology, ok := definition["topology"].(map[string]any); ok {
		if defaults, ok := topology["defaults"].(map[string]any); ok {
			delete(defaults, "labels")
		}
		for _, section := range []string{"kinds", "groups", "nodes"} {
			entries, _ := topology[section].(map[string]any)
			for _, entry := range entries {
				if fields, ok := entry.(map[string]any); ok {
					delete(fields, "labels")
				}
			}
		}
	}

	out, err := yaml.Marshal(definition)
	return string(out), err
}

// applyTopology creates the namespace and the clabernetes Topology for a lab, or updates the Topology's
// definition if it already exists.
func (p *ClabernetesProvider) applyTopology(ctx context.Context, namespace, instanceName, definition string) error {
	_, err := p.clientset.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: namespace,
			// Device pods run privileged containers
			Labels: map[string]string{"pod-security.kubernetes.io/enforce": "privileged"},
		},
	}, metav1.CreateOptions{})

	if err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create namespace %s: %w", namespace, err)
	}

	spec := c9sv1alpha1.TopologySpec{
		Definition: c9sv1alpha1.Definition{Containerlab: definition},
		Expose:     c9sv1alpha1.Expose{ExposeType: "None"},
	}

	topologies := p.c9s.C9sV1alpha1().Topologies(namespace)
	_, err = topologies.Create(ctx, &c9sv1alpha1.Topology{
		ObjectMeta: metav1.ObjectMeta{Name: instanceName, Namespace: namespace},
		Spec:       spec,
	}, metav1.CreateOptions{})

	if !apierrors.IsAlreadyExists(err) {
		return err
	}

	existing, err := topologies.Get(ctx, instanceName, metav1.GetOptions{})
	if err != nil {
		return err
	}

	existing.Spec = spec
	_, err = topologies.Update(ctx, existing, metav1.UpdateOptions{})

	return err
}

// setIgnoreReconcile toggles the label that tells the manager to skip reconciling
// this node, so a scale-down of its deployment isn't reverted.
func (p *ClabernetesProvider) setIgnoreReconcile(ctx context.Context, ns, node string, ignored bool) error {
	value := "null" // JSON null removes the label in a merge patch
	if ignored {
		value = `"true"`
	}
	patch := fmt.Sprintf(`{"metadata":{"labels":{%q:%s}}}`, clabernetesconstants.LabelIgnoreReconcile, value)
	_, err := p.c9s.C9sV1alpha1().Nodes(ns).Patch(ctx, node, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

func (p *ClabernetesProvider) scaleNode(ctx context.Context, ns, node string, replicas int32) error {
	patch := fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicas)
	_, err := p.clientset.AppsV1().
		Deployments(ns).
		Patch(ctx, node, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

type kubernetesExecSession struct {
	io.Reader
	stdinW *io.PipeWriter
	sizes  *sizeQueue
	cancel context.CancelFunc
}

func (s *kubernetesExecSession) Write(p []byte) (int, error) { return s.stdinW.Write(p) }

func (s *kubernetesExecSession) Resize(cols, rows uint) error {
	s.sizes.push(cols, rows)
	return nil
}

func (s *kubernetesExecSession) Close() error {
	err := s.stdinW.Close()
	s.cancel()
	close(s.sizes.ch)
	return err
}

type sizeQueue struct {
	ch chan remotecommand.TerminalSize
}

func createSizeQueue() *sizeQueue {
	return &sizeQueue{ch: make(chan remotecommand.TerminalSize, 8)}
}

func (q *sizeQueue) Next() *remotecommand.TerminalSize {
	s, ok := <-q.ch
	if !ok {
		return nil
	}
	return &s
}

func (q *sizeQueue) push(cols, rows uint) {
	select {
	case q.ch <- remotecommand.TerminalSize{Width: uint16(cols), Height: uint16(rows)}:
	default:
	}
}

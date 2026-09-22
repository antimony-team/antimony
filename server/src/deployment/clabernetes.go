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
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	c9sv1alpha1 "github.com/clabernetes/clabernetes/apis/v1alpha1"
	"github.com/clabernetes/clabernetes/clabverter"
	clabernetesconstants "github.com/clabernetes/clabernetes/constants"
	c9sclientset "github.com/clabernetes/clabernetes/generated/clientset"
	"github.com/google/gopacket/afpacket"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
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
	onLog func(string),
) error {
	namespace := namespaceFor(instanceName)
	manifestDir := filepath.Join(filepath.Dir(topologyFile), "c9s")

	cv := clabverter.MustNewClabverter(
		topologyFile,
		"",
		manifestDir,
		namespace,
		"non-prefixed",
		"",
		"",
		"",
		true,
		false,
		false,
		true,
		false,
	)

	onLog(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Starting clabvertion of topology",
		"instance", instanceName,
	))

	if err := cv.Clabvert(); err != nil {
		onLog(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Clabvertion of topology failed",
			"instance", instanceName,
			"err", err.Error(),
		))
		return fmt.Errorf("clabvert %s: %w", topologyFile, err)
	}

	onLog(serverlog.CreateAntimonyLog(
		serverlog.SuccessLevel,
		"Clabvertion of topology completed",
		"instance", instanceName,
	))

	onLog(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Starting deployment of kubernetes manifest",
		"instance", instanceName,
		"namespace", namespace,
	))

	cmd := exec.CommandContext(ctx, "kubectl", "apply", "-f", manifestDir, "-v=6")

	out, err := runCommandSync(cmd, serverlog.FormatKubectlLog(onLog))

	if out != nil {
		logLines := strings.Split(*out, "\n")
		for _, line := range logLines {
			logLine := serverlog.CreateKubeCtlLog(line)
			if logLine != "" {
				onLog(logLine)
			}
		}
	}

	if err != nil {
		onLog(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Deployment of kubernetes manifest failed",
			"instance", instanceName,
			"namespace", namespace,
			"err", err.Error(),
		))

		return err
	}

	onLog(serverlog.CreateAntimonyLog(
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
	onLog func(string),
) error {
	if err := p.Destroy(ctx, topologyFile, instanceName, onLog); err != nil {
		return err
	}

	// Kubectl's Apply is declarative, so we can just apply again
	return p.Deploy(ctx, topologyFile, instanceName, onLog)
}

func (p *ClabernetesProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog func(string),
) error {
	namespace := namespaceFor(instanceName)

	pods, err := p.clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: clabernetesconstants.LabelTopologyNode,
	})
	if err != nil && !apierrors.IsNotFound(err) {
		onLog(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to fetch pods in namespace",
			"err", err.Error(),
		))
		return err
	}

	if pods != nil {
		for _, pod := range pods.Items {
			onLog(serverlog.CreateAntimonyLog(
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
		onLog(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to fetch collection in namespace",
			"err", err.Error(),
		))
		return err
	}

	onLog(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Deleting namespace",
		"namespace", namespace,
	))

	if err := p.clientset.CoreV1().
		Namespaces().
		Delete(ctx, namespace, metav1.DeleteOptions{GracePeriodSeconds: &zero}); err != nil {
		if apierrors.IsNotFound(err) {
			// The namespace has already been destroyed
			onLog(serverlog.CreateAntimonyLog(
				serverlog.WarningLevel,
				"The namespace has already been removed",
				"namespace", namespace,
			))
			return nil
		}

		onLog(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Deletion of namespace failed",
			"namespace", namespace,
			"err", err.Error(),
		))
		return err
	}

	onLog(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Waiting for namespace to be removed",
		"namespace", namespace,
	))

	return p.waitForNamespaceGone(ctx, namespace, onLog)
}

func (p *ClabernetesProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog func(string),
) (InspectOutput, error) {
	return p.inspect(ctx, namespaceFor(instanceName), topologyFile)
}

func (p *ClabernetesProvider) InspectAll(ctx context.Context) (InspectOutput, error) {
	return p.inspect(ctx, metav1.NamespaceAll, "")
}

// inspect lists the running node pods in ns (all namespaces when empty) and
// appends an "exited" entry for every node deployment scaled to zero, since
// stopped nodes have no pod.
func (p *ClabernetesProvider) inspect(ctx context.Context, namespace string, labPath string) (InspectOutput, error) {
	selector := metav1.ListOptions{LabelSelector: clabernetesconstants.LabelTopologyNode}

	pods, err := p.clientset.CoreV1().Pods(namespace).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node pods: %w", err)
	}

	deployments, err := p.clientset.AppsV1().Deployments(namespace).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node deployments: %w", err)
	}

	output := InspectOutput{}
	for i := range pods.Items {

		if pods.Items[i].DeletionTimestamp != nil {
			continue
		}
		c := podToInspectContainer(&pods.Items[i], labPath)
		output[c.LabName] = append(output[c.LabName], c)
	}
	for i := range deployments.Items {
		d := &deployments.Items[i]
		if d.Spec.Replicas == nil || *d.Spec.Replicas != 0 {
			continue // has (or will have) a pod: already covered above
		}
		c := stoppedDeploymentToInspectContainer(d, labPath)
		output[c.LabName] = append(output[c.LabName], c)
	}
	return output, nil
}

func podToInspectContainer(pod *corev1.Pod, labPath string) InspectContainer {
	c := InspectContainer{
		LabName:     pod.Labels[clabernetesconstants.LabelTopologyOwner],
		LabPath:     labPath,
		Name:        pod.Labels[clabernetesconstants.LabelTopologyNode],
		ContainerId: string(pod.UID),
		Kind:        pod.Labels[clabernetesconstants.LabelTopologyKind],
		State:       podStateToNodeState(pod),
		Owner:       pod.Namespace,
	}
	if len(pod.Spec.Containers) > 0 {
		c.Image = pod.Spec.Containers[0].Image
	}
	for _, ip := range pod.Status.PodIPs {
		if strings.Contains(ip.IP, ":") {
			c.IPv6Address = ip.IP
		} else {
			c.IPv4Address = ip.IP
		}
	}
	return c
}

func stoppedDeploymentToInspectContainer(d *appsv1.Deployment, labPath string) InspectContainer {
	fmt.Printf("STOPPED POD: %s/%s\n", d.Namespace, d.Labels[clabernetesconstants.LabelTopologyNode])

	c := InspectContainer{
		LabName:     d.Labels[clabernetesconstants.LabelTopologyOwner],
		LabPath:     labPath,
		Name:        d.Labels[clabernetesconstants.LabelTopologyNode],
		ContainerId: "",
		Kind:        d.Labels[clabernetesconstants.LabelTopologyKind],
		State:       NodeStates.Stopped,
		Owner:       d.Namespace,
	}
	if cs := d.Spec.Template.Spec.Containers; len(cs) > 0 {
		c.Image = cs[0].Image
	}
	return c
}

func podStateToNodeState(pod *corev1.Pod) NodeState {
	if pod.DeletionTimestamp != nil {
		return starting // being replaced
	}
	switch pod.Status.Phase {
	case corev1.PodSucceeded, corev1.PodFailed:
		return NodeStates.Stopped
	case corev1.PodRunning:
		for _, c := range pod.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
				return running
			}
		}
	}
	return starting
}

func (p *ClabernetesProvider) Exec(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (string, int, error) {
	namespace := namespaceFor(instanceName)
	podName, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return "", 0, err
	}

	executor, err := p.createExec(namespace, podName, cmd, false, true)
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
		if codeErr.Code == nodeNotRunningExitCode {
			return "", 0, utils.ErrNodeNotRunning
		}
		return output, codeErr.Code, nil
	}
	return output, 0, err
}

func (p *ClabernetesProvider) ExecInteractive(
	ctx context.Context,
	instanceName string,
	nodeName string,
	cmd []string,
) (ShellExecSession, error) {
	namespace := namespaceFor(instanceName)
	podName, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return nil, err
	}

	executor, err := p.createExec(namespace, podName, cmd, true, true)
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
			if codeErr.Code == nodeNotRunningExitCode {
				err = utils.ErrNodeNotRunning
			} else {
				err = nil // shell exited on its own; that's a clean EOF
			}
		}

		_ = stdoutW.CloseWithError(err)
	}()

	return session, nil
}

// nodeTunnelTemplate runs in the launcher: it connects to the device's
// management IP and relays stdin/stdout to the socket.
const nodeTunnelTemplate = `
ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(docker ps -q | head -n1)")
if [ -z "$ip" ]; then echo 'node container is not running' >&2; exit %d; fi
exec 3<>"/dev/tcp/$ip/%d" || exit 1
cat <&3 &
cat >&3
kill $! 2>/dev/null
`

func (p *ClabernetesProvider) DialNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
	port int,
) (net.Conn, error) {
	namespace := namespaceFor(instanceName)
	podName, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return nil, err
	}

	script := fmt.Sprintf(nodeTunnelTemplate, nodeNotRunningExitCode, port)

	// This will run inside the launcher and not the node container itself, so we can't use createExec.
	req := p.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Command: []string{"bash", "-c", script},
			Stdin:   true,
			Stdout:  true,
			Stderr:  true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(p.restConfig, "POST", req.URL())
	if err != nil {
		return nil, err
	}

	local, remote := net.Pipe()

	go func() {
		_ = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdin:  remote,
			Stdout: remote,
			Stderr: io.Discard,
		})
		_ = remote.Close()
	}()

	return local, nil
}

func (p *ClabernetesProvider) OpenCapture(
	ctx context.Context,
	instanceName string,
	nodeName string,
	interfaceName string,
) (*afpacket.TPacket, error) {
	return nil, nil
}

//	func (p *ClabernetesProvider) StartNode(ctx context.Context, instanceName string, containerId string) error {
//		//ns := namespaceFor(instanceName)
//		//node, err := p.nodeNameForPod(ctx, ns, containerId)
//		//if err != nil {
//		//	return err
//		//}
//		//if err := p.setDisableDeployments(ctx, ns, node, false); err != nil {
//		//	return err
//		//}
//		//return p.scaleNode(ctx, ns, node, 1)
//		return nil
//	}
//
//	func (p *ClabernetesProvider) StopNode(ctx context.Context, instanceName string, containerId string) error {
//		//ns := namespaceFor(instanceName)
//		//node, err := p.nodeNameForPod(ctx, ns, containerId)
//		//if err != nil {
//		//	return err
//		//}
//		//if err := p.setDisableDeployments(ctx, ns, node, true); err != nil {
//		//	return err
//		//}
//		//return p.scaleNode(ctx, ns, node, 0)
//		return nil
//	}
//
//	func (p *ClabernetesProvider) `RestartNode`(ctx context.Context, instanceName string, containerId string) error {
//		//ns := namespaceFor(instanceName)
//		//grace := int64(10)
//		//return p.clientset.CoreV1().Pods(ns).Delete(ctx, containerId, metav1.DeleteOptions{
//		//	GracePeriodSeconds: &grace,
//		//})
//		return nil
//	}
func (p *ClabernetesProvider) StartNode(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	namespace := namespaceFor(instanceName)
	if err := p.setDisableDeployments(ctx, namespace, nodeName, false); err != nil {
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
	if err := p.setDisableDeployments(ctx, namespace, nodeName, true); err != nil {
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
		//UpdateFunc: func(oldObj, newObj any) {
		//	o, n := oldObj.(*corev1.Pod), newObj.(*corev1.Pod)
		//	// Only phase/readiness changes matter; pods are updated for many other reasons.
		//	if o.Status.Phase != n.Status.Phase || isReady(o) != isReady(n) ||
		//		(o.DeletionTimestamp == nil) != (n.DeletionTimestamp == nil) {
		//		onUpdate(n.Name)
		//	}
		//},
	})

	if err != nil {
		return err
	}

	// Deployments carry the stop/start state (replicas 0/1); a stopped node has no pod to watch.
	_, err = factory.Apps().V1().Deployments().Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		UpdateFunc: func(oldObj, newObj any) {
			o, n := oldObj.(*appsv1.Deployment), newObj.(*appsv1.Deployment)
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

func isReady(pod *corev1.Pod) bool {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady {
			return c.Status == corev1.ConditionTrue
		}
	}
	return false
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

// dockerLogsScript runs in the launcher and follows the device container's
// logs. `docker ps -a` includes a stopped container, so logs of a crashed
// node are still readable.
const dockerLogsScript = `
c=$(docker ps -aq | head -n1)
if [ -z "$c" ]; then
  echo 'node container not found' >&2
  exit 200
fi
exec docker logs --follow --timestamps "$c"
`

func (p *ClabernetesProvider) StreamContainerLogs(
	ctx context.Context,
	instanceName string,
	nodeName string,
	onLog func(data string),
) error {
	namespace := namespaceFor(instanceName)
	podName, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return err
	}

	// The launcher forwards the node container's output to its own stdout, so the pod log is the node log.
	// Kubernetes prepends an RFC 3339 timestamp per line.
	stream, err := p.clientset.CoreV1().
		Pods(namespace).
		GetLogs(podName, &corev1.PodLogOptions{
			Follow:     true,
			Timestamps: true,
		}).
		Stream(ctx)
	if err != nil {
		return err
	}

	onLogWrapper := func(msg string) {
		onLog(serverlog.ReplaceAnsiCharacters(msg))
	}

	go func() {
		defer stream.Close()
		streamOutput(stream, onLogWrapper)
	}()

	return nil
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
	podName, err := p.podForNode(ctx, namespace, nodeName)
	if err != nil {
		return err
	}

	executor, err := p.createExec(namespace, podName, cmd, false, true)
	if err != nil {
		return err
	}

	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: w,
		Stderr: io.Discard,
	})

	var codeErr k8sexec.CodeExitError
	if errors.As(err, &codeErr) && codeErr.Code == nodeNotRunningExitCode {
		return utils.ErrNodeNotRunning
	}

	return err
}

// waitForTopologyReady is used by the Deploy function to wait until all nodes in a lab are deployed and ready.
func (p *ClabernetesProvider) waitForTopologyReady(
	ctx context.Context,
	namespace string,
	instanceName string,
	onLog func(string),
) error {
	lastReady := -1

	return wait.PollUntilContextTimeout(ctx, time.Second, 10*time.Minute, true,
		func(ctx context.Context) (bool, error) {
			topo, err := p.c9s.C9sV1alpha1().Topologies(namespace).Get(ctx, instanceName, metav1.GetOptions{})
			if err != nil {
				return false, err
			}
			st := topo.Status

			if st.ReadyNodeCount != lastReady && onLog != nil {
				onLog(serverlog.CreateAntimonyLog(
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
	onLog func(string),
) error {
	return wait.PollUntilContextTimeout(ctx, time.Second, 2*time.Minute, true,
		func(ctx context.Context) (bool, error) {
			_, err := p.clientset.CoreV1().Namespaces().Get(ctx, namespace, metav1.GetOptions{})
			if apierrors.IsNotFound(err) {
				onLog(serverlog.CreateAntimonyLog(
					serverlog.SuccessLevel,
					"Deletion of namespace succeeded",
					"namespace", namespace,
				))

				return true, nil
			}

			if err != nil {
				onLog(serverlog.CreateAntimonyLog(
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

// createExec prepares a pods/exec request for cmd inside the node container.
func (p *ClabernetesProvider) createExec(
	namespace string,
	podName string,
	cmd []string,
	tty bool,
	wrapCmd bool,
) (remotecommand.Executor, error) {
	if wrapCmd {
		cmd = wrapNodeCommand(cmd, tty)
	}

	req := p.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Command: cmd,
			Stdin:   tty,
			Stdout:  true,
			Stderr:  !tty, // merged into stdout when a TTY is allocated
			TTY:     tty,
		}, scheme.ParameterCodec)

	return remotecommand.NewSPDYExecutor(p.restConfig, "POST", req.URL())
}

// podForNode returns the name of the pod currently backing a node. It returns ErrNodeNotRunning when the node has no
// live pod: stopped, or started but not created yet.
func (p *ClabernetesProvider) podForNode(ctx context.Context, namespace, nodeName string) (string, error) {
	pods, err := p.clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: clabernetesconstants.LabelTopologyNode + "=" + nodeName,
	})
	if err != nil {
		return "", err
	}

	for i := range pods.Items {
		if pods.Items[i].DeletionTimestamp == nil && pods.Items[i].Status.Phase == corev1.PodRunning {
			return pods.Items[i].Name, nil
		}
	}
	return "", utils.ErrNodeNotRunning
}

// nodeNotRunningExitCode is the exit code wrapNodeCommand's wrapper uses to
// signal that the launcher has no running device container. It is mapped to
// ErrNodeNotRunning by translateExecError and never leaves this provider.
const nodeNotRunningExitCode = 200

// nodeCommandTemplate runs inside the launcher. %[1]d is the not-running exit
// code, %[2]s the docker exec flags, %[3]s the quoted command.
const nodeCommandTemplate = `
c=$(docker ps -q | head -n1)
if [ -z "$c" ]; then
  echo 'node container is not running' >&2
  exit %[1]d
fi
exec docker exec %[2]s "$c" %[3]s
`

// wrapNodeCommand wraps cmd so it runs inside the device container rather than in
// the clabernetes launcher that pods/exec lands in. The launcher runs exactly
// one docker container: the node itself.
// The command returns the nodeNotRunningExitCode error code if the node is not running yet.
func wrapNodeCommand(cmd []string, tty bool) []string {
	quoted := make([]string, len(cmd))
	for i, arg := range cmd {
		quoted[i] = "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
	}

	flags := ""
	if tty {
		flags = "-it "
	}

	script := fmt.Sprintf(nodeCommandTemplate, nodeNotRunningExitCode, flags, strings.Join(quoted, " "))
	return []string{"sh", "-c", script}
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

// nodeNameForPod returns the containerlab node name of a pod, which under
// non-prefixed naming is also the name of its Deployment and Node CR.
func (p *ClabernetesProvider) nodeNameForPod(ctx context.Context, ns, pod string) (string, error) {
	po, err := p.clientset.CoreV1().Pods(ns).Get(ctx, pod, metav1.GetOptions{})
	if err != nil {
		fmt.Printf("FAILED TO GET NODE %s/%s: %v", ns, pod, err)
		return "", err
	}
	node := po.Labels[clabernetesconstants.LabelTopologyNode]
	if node == "" {
		return "", fmt.Errorf("pod %s/%s has no %s label", ns, pod, clabernetesconstants.LabelTopologyNode)
	}
	return node, nil
}

// setDisableDeployments toggles the label that tells the manager to leave
// this node's deployment alone, so a scale-down isn't reverted.
func (p *ClabernetesProvider) setDisableDeployments(ctx context.Context, ns, node string, disabled bool) error {
	value := "null" // JSON null removes the label in a merge patch
	if disabled {
		value = `"true"`
	}
	patch := fmt.Sprintf(`{"metadata":{"labels":{%q:%s}}}`, clabernetesconstants.LabelDisableDeployments, value)
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

type podCondition struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

type podIP struct {
	IP string `json:"ip"`
}

type podList struct {
	Items []struct {
		Metadata struct {
			Name      string            `json:"name"`
			Namespace string            `json:"namespace"`
			UID       string            `json:"uid"`
			Labels    map[string]string `json:"labels"`
		} `json:"metadata"`
		Spec struct {
			Containers []struct {
				Image string `json:"image"`
			} `json:"containers"`
		} `json:"spec"`
		Status struct {
			Phase      string         `json:"phase"`
			PodIPs     []podIP        `json:"podIPs"`
			Conditions []podCondition `json:"conditions"`
		} `json:"status"`
	} `json:"items"`
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

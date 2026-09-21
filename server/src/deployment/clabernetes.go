package deployment

import (
	"antimonyBackend/utils/serverlog"
	"bytes"
	"context"
	"encoding/json"
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
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
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

	provider.statsReader = CreateStatsReader[podRef](createRemoteSampler(provider.execStream))

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

//func (p *ClabernetesProvider) Inspect(
//	ctx context.Context,
//	topologyFile string,
//	instanceName string,
//	onLog func(string),
//) (InspectOutput, error) {
//	return p.inspectNamespace(ctx, namespaceFor(instanceName), topologyFile)
//}
//
//func (p *ClabernetesProvider) InspectAll(ctx context.Context) (InspectOutput, error) {
//	return p.inspectNamespace(ctx, metav1.NamespaceAll, "")
//}

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
func (p *ClabernetesProvider) inspect(ctx context.Context, ns, labPath string) (InspectOutput, error) {
	selector := metav1.ListOptions{LabelSelector: clabernetesconstants.LabelTopologyNode}

	pods, err := p.clientset.CoreV1().Pods(ns).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node pods: %w", err)
	}
	deployments, err := p.clientset.AppsV1().Deployments(ns).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node deployments: %w", err)
	}

	output := InspectOutput{}
	for i := range pods.Items {
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
		ContainerId: pod.Name,
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
		ContainerId: d.Name, // no pod exists; equals the node name under non-prefixed naming
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
	containerId string,
	cmd []string,
) (string, int, error) {
	namespace := namespaceFor(instanceName)

	executor, err := p.createExec(namespace, containerId, cmd, false, true)
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
			return "", 0, ErrNodeNotRunning
		}
		return output, codeErr.Code, nil
	}
	return output, 0, err
}

func (p *ClabernetesProvider) ExecInteractive(
	ctx context.Context,
	instanceName string,
	containerId string,
	cmd []string,
) (ShellExecSession, error) {
	namespace := namespaceFor(instanceName)

	executor, err := p.createExec(namespace, containerId, cmd, true, true)
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
				err = fmt.Errorf("%w: %s/%s", ErrNodeNotRunning, namespace, containerId)
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
	instanceName, containerId string,
	port int,
) (net.Conn, error) {
	ns := namespaceFor(instanceName)
	script := fmt.Sprintf(nodeTunnelTemplate, nodeNotRunningExitCode, port)

	// This will run inside the launcher and not the node container itself, so we can't use createExec.
	req := p.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(ns).
		Name(containerId).
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
		_ = executor.StreamWithContext(context.Background(), remotecommand.StreamOptions{
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
	containerId string,
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
func (p *ClabernetesProvider) StartNode(ctx context.Context, instanceName, containerId string) error {
	ns := namespaceFor(instanceName)
	node, err := p.nodeNameForPod(ctx, ns, containerId)
	if err != nil {
		return err
	}
	if err := p.setDisableDeployments(ctx, ns, node, false); err != nil {
		return err
	}
	return p.scaleNode(ctx, ns, node, 1)
}

func (p *ClabernetesProvider) StopNode(ctx context.Context, instanceName, containerId string) error {
	ns := namespaceFor(instanceName)
	node, err := p.nodeNameForPod(ctx, ns, containerId)
	if err != nil {
		return err
	}
	if err := p.setDisableDeployments(ctx, ns, node, true); err != nil {
		return err
	}
	return p.scaleNode(ctx, ns, node, 0)
}

func (p *ClabernetesProvider) RestartNode(ctx context.Context, instanceName, containerId string) error {
	ns := namespaceFor(instanceName)
	grace := int64(10)
	return p.clientset.CoreV1().Pods(ns).Delete(ctx, containerId, metav1.DeleteOptions{
		GracePeriodSeconds: &grace,
	})
}

func (p *ClabernetesProvider) RegisterListener(ctx context.Context, onUpdate func(containerId string)) error {
	return nil
}

func (p *ClabernetesProvider) RegisterEventListener(
	ctx context.Context,
	onUpdate func(containerlabEvent ContainerlabEvent),
) error {
	return nil
}

func (p *ClabernetesProvider) ReadNodeStats(
	ctx context.Context,
	instanceName string,
	containerId string,
) (*NodeStats, error) {
	namespace := namespaceFor(instanceName)
	nodeId := namespace + "/" + containerId

	return p.statsReader.Read(ctx, nodeId, podRef{instanceName: instanceName, podName: containerId})
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
	containerId string,
	onLog func(data string),
) error {
	namespace := namespaceFor(instanceName)

	// The launcher forwards the node container's output to its own stdout, so the pod log is the node log.
	// Kubernetes prepends an RFC 3339 timestamp per line.
	stream, err := p.clientset.CoreV1().Pods(namespace).
		GetLogs(containerId, &corev1.PodLogOptions{
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

func (p *ClabernetesProvider) GetInterfaces(
	ctx context.Context,
	instanceName string,
	containerId string,
) ([]NodeInterface, error) {
	namespace := namespaceFor(instanceName)

	listInterfacesScript := `for d in /sys/class/net/*; do
	  n=${d##*/}; [ "$n" = lo ] && continue
	  echo "$n $(cat $d/address 2>/dev/null) $(cat $d/mtu 2>/dev/null) $(cat $d/operstate 2>/dev/null)"
	done`

	out, code, err := p.Exec(
		ctx,
		instanceName,
		containerId,
		[]string{"sh", "-c", listInterfacesScript},
	)

	if err != nil {
		return nil, fmt.Errorf("list interfaces in %s/%s: %w", namespace, containerId, err)
	}

	if code != 0 {
		return nil, fmt.Errorf("list interfaces of %s: exit code %d: %s", containerId, code, strings.TrimSpace(out))
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

// execStream runs cmd inside the node and copies its stdout to w until ctx is
// canceled or the command exits. Unlike Exec, it does not collect output or
// an exit code; it is meant for long-running commands that emit continuously.
func (p *ClabernetesProvider) execStream(
	ctx context.Context,
	instanceName string,
	containerId string,
	cmd []string,
	w io.Writer,
) error {
	namespace := namespaceFor(instanceName)

	executor, err := p.createExec(namespace, containerId, cmd, false, true)
	if err != nil {
		return err
	}

	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: w,
		Stderr: io.Discard,
	})

	var codeErr k8sexec.CodeExitError
	if errors.As(err, &codeErr) && codeErr.Code == nodeNotRunningExitCode {
		return ErrNodeNotRunning
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
	pod string,
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
		Name(pod).
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

// translateExecError maps the launcher's "device not running" exit code onto
// the provider-neutral sentinel; any other exit code is returned as-is.
func translateExecError(err error, ns, pod string) (exitCode int, retErr error) {
	var codeErr k8sexec.CodeExitError
	if errors.As(err, &codeErr) {
		if codeErr.Code == nodeNotRunningExitCode {
			return 0, fmt.Errorf("%w: %s/%s", ErrNodeNotRunning, ns, pod)
		}
		return codeErr.Code, nil
	}
	return 0, err
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

// inspectNamespace lists the node deployments in ns (all namespaces when ns
// is empty) and joins each with its pod, if it currently has one.
func (p *ClabernetesProvider) inspectNamespace(ctx context.Context, ns, labPath string) (InspectOutput, error) {
	selector := metav1.ListOptions{LabelSelector: clabernetesconstants.LabelTopologyNode}

	deployments, err := p.clientset.AppsV1().Deployments(ns).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node deployments: %w", err)
	}
	pods, err := p.clientset.CoreV1().Pods(ns).List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("list node pods: %w", err)
	}

	// namespace/node -> live pod (prefer one that isn't terminating)
	podByNode := make(map[string]*corev1.Pod, len(pods.Items))
	for i := range pods.Items {
		pod := &pods.Items[i]
		key := pod.Namespace + "/" + pod.Labels[clabernetesconstants.LabelTopologyNode]
		if cur, ok := podByNode[key]; !ok || cur.DeletionTimestamp != nil {
			podByNode[key] = pod
		}
	}

	output := InspectOutput{}
	for i := range deployments.Items {
		d := &deployments.Items[i]
		node := d.Labels[clabernetesconstants.LabelTopologyNode]
		labName := d.Labels[clabernetesconstants.LabelTopologyOwner]
		pod := podByNode[d.Namespace+"/"+node]

		c := InspectContainer{
			LabName:     labName,
			LabPath:     labPath,
			Name:        node,
			ContainerId: node, // stable across restarts; the provider resolves the pod itself
			Kind:        d.Labels[clabernetesconstants.LabelTopologyKind],
			State:       nodeState(d, pod),
			Owner:       d.Namespace,
		}
		if len(d.Spec.Template.Spec.Containers) > 0 {
			c.Image = d.Spec.Template.Spec.Containers[0].Image
		}
		if pod != nil {
			for _, ip := range pod.Status.PodIPs {
				if strings.Contains(ip.IP, ":") {
					c.IPv6Address = ip.IP
				} else {
					c.IPv4Address = ip.IP
				}
			}
		}
		output[labName] = append(output[labName], c)
	}
	return output, nil
}

// nodeState derives the containerlab-style state from the deployment's
// desired replicas and the pod's readiness.
func nodeState(d *appsv1.Deployment, pod *corev1.Pod) NodeState {
	if d.Spec.Replicas != nil && *d.Spec.Replicas == 0 {
		return NodeStates.Stopped // stopped via StopNode
	}
	if pod == nil || pod.DeletionTimestamp != nil {
		return starting // not created yet, or being replaced
	}
	switch pod.Status.Phase {
	case corev1.PodSucceeded, corev1.PodFailed:
		return NodeStates.Stopped
	case corev1.PodRunning:
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
				return running
			}
		}
	}
	return starting
}

type deploymentList struct {
	Items []struct {
		Metadata struct {
			Name      string            `json:"name"`
			Namespace string            `json:"namespace"`
			Labels    map[string]string `json:"labels"`
		} `json:"metadata"`
		Spec struct {
			Replicas *int32 `json:"replicas"`
			Template struct {
				Spec struct {
					Containers []struct {
						Image string `json:"image"`
					} `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	} `json:"items"`
}

// addStoppedNodes appends an "exited" entry for every node deployment that is
// scaled to zero, since such nodes have no pod and don't appear in the pod list.
func addStoppedNodes(output InspectOutput, raw string, labPath string) error {
	if raw == "" {
		return nil
	}

	var list deploymentList
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return fmt.Errorf("parse deployment list: %w", err)
	}

	for _, d := range list.Items {
		if d.Spec.Replicas == nil || *d.Spec.Replicas != 0 {
			continue // has a pod (or will have): covered by the pod list
		}
		labName := d.Metadata.Labels[clabernetesconstants.LabelTopologyOwner]
		node := d.Metadata.Labels[clabernetesconstants.LabelTopologyNode]

		c := InspectContainer{
			LabName:     labName,
			LabPath:     labPath,
			Name:        node,
			ContainerId: node, // no pod exists; StartNode accepts the node name
			Kind:        d.Metadata.Labels[clabernetesconstants.LabelTopologyKind],
			State:       NodeStates.Stopped,
			Owner:       d.Metadata.Namespace,
		}
		if cs := d.Spec.Template.Spec.Containers; len(cs) > 0 {
			c.Image = cs[0].Image
		}
		output[labName] = append(output[labName], c)
	}
	return nil
}

//func podsToInspectOutput(raw string, labPath string) (InspectOutput, error) {
//	if raw == "" {
//		return InspectOutput{}, nil
//	}
//
//	var list podList
//	if err := json.Unmarshal([]byte(raw), &list); err != nil {
//		return nil, fmt.Errorf("parse pod list: %w", err)
//	}
//
//	output := InspectOutput{}
//	for _, pod := range list.Items {
//		labName := pod.Metadata.Labels[clabernetesconstants.LabelTopologyOwner]
//
//		c := InspectContainer{
//			LabName:     labName,
//			LabPath:     labPath,
//			Name:        pod.Metadata.Labels[clabernetesconstants.LabelTopologyNode],
//			ContainerId: pod.Metadata.Name,
//			Kind:        pod.Metadata.Labels[clabernetesconstants.LabelTopologyKind],
//			State:       podStateToNodeState(pod.Status.Phase, pod.Status.Conditions),
//			Owner:       pod.Metadata.Namespace,
//		}
//		if len(pod.Spec.Containers) > 0 {
//			c.Image = pod.Spec.Containers[0].Image
//		}
//		for _, ip := range pod.Status.PodIPs {
//			if strings.Contains(ip.IP, ":") {
//				c.IPv6Address = ip.IP
//			} else {
//				c.IPv4Address = ip.IP
//			}
//		}
//
//		output[labName] = append(output[labName], c)
//	}
//	return output, nil
//}

//func podStateToNodeState(phase string, conditions []podCondition) NodeState {
//	switch phase {
//	case "Succeeded", "Failed":
//		return exited
//	case "Running":
//		for _, c := range conditions {
//			if c.Type == "Ready" && c.Status == "True" {
//				return running
//			}
//		}
//	}
//	return starting
//}

func namespaceFor(topologyName string) string {
	return "c9s-" + topologyName
}

// nodeNameForPod returns the containerlab node name of a pod, which under
// non-prefixed naming is also the name of its Deployment and Node CR.
func (p *ClabernetesProvider) nodeNameForPod(ctx context.Context, ns, pod string) (string, error) {
	po, err := p.clientset.CoreV1().Pods(ns).Get(ctx, pod, metav1.GetOptions{})
	if err != nil {
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

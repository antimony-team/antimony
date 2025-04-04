package deployment

import (
	"context"
	"encoding/json"
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type TopologyMeta struct {
	Name string `yaml:"name"`
}

type ClabernetesProvider struct{}

func (p *ClabernetesProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "sh", "-c",
		"clabverter -t '"+topologyFile+"' --stdout --naming non-prefixed | kubectl apply -f -")
	runClabCommand(cmd, onLog, onDone)
}

func (p *ClabernetesProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	cmd := exec.CommandContext(ctx, "docker", "start", "kind-control-plane")
	runClabCommand(cmd, onLog, onDone)
}

func (p *ClabernetesProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error),
) {

	namespace := getTopologyName(topologyFile, onLog)
	cmd := exec.CommandContext(ctx, "kubectl", "delete", "namespace", namespace)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ClabernetesProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *InspectOutput, err error),
) {
	namespace := getTopologyName(topologyFile, onLog)

	cmd := exec.CommandContext(ctx, "kubectl", "get", "pods", "-n", namespace, "-o", "json")
	runClabCommand(cmd, onLog, func(output *string, err error) {
		if err != nil {
			onDone(nil, err)
			return
		}

		if output == nil || *output == "" {
			onDone(&InspectOutput{Containers: []InspectContainer{}}, nil)
			return
		}

		var raw struct {
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Status struct {
					PodIP             string `json:"podIP"`
					Phase             string `json:"phase"`
					ContainerStatuses []struct {
						Image       string `json:"image"`
						ContainerID string `json:"containerID"`
					} `json:"containerStatuses"`
				} `json:"status"`
			} `json:"items"`
		}

		if err := json.Unmarshal([]byte(*output), &raw); err != nil {
			onDone(nil, fmt.Errorf("failed to parse pod list: %w", err))
			return
		}

		var containers []InspectContainer
		for _, pod := range raw.Items {
			var containerID, image string
			if len(pod.Status.ContainerStatuses) > 0 {
				containerID = pod.Status.ContainerStatuses[0].ContainerID
				image = pod.Status.ContainerStatuses[0].Image
			}

			containers = append(containers, InspectContainer{
				Name:        pod.Metadata.Name,
				ContainerId: containerID,
				Image:       image,
				State:       NodeState(pod.Status.Phase),
				IPv4Address: pod.Status.PodIP,
				Kind:        "clabernetes",
				Owner:       namespace,
			})
		}

		onDone(&InspectOutput{Containers: containers}, nil)
	})
}

func (p *ClabernetesProvider) InspectAll( //not tested
	ctx context.Context,
) (*InspectOutput, error) {
	cmd := exec.CommandContext(ctx, "kubectl", "get", "topology", "--all-namespaces", "-o", "json")
	if output, err := runClabCommandSync(cmd); err != nil {
		return nil, err
	} else {
		if *output == "" {
			return &InspectOutput{Containers: []InspectContainer{}}, nil
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(*output), &raw); err != nil {
			return nil, err
		}

		// You could extract data from raw["items"] here into InspectOutput, or leave empty.
		return &InspectOutput{Containers: []InspectContainer{}}, nil
	}
}
func (p *ClabernetesProvider) Exec(ctx context.Context,
	topologyFile string,
	content string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
}
func (p *ClabernetesProvider) ExecOnNode(
	ctx context.Context,
	topologyFile string,
	content string,
	nodeLabel string,
	onLog func(data string),
	onDone func(output *string, err error),
) {
	labName := strings.TrimSuffix(filepath.Base(topologyFile), filepath.Ext(topologyFile))
	namespace := "c9s-" + labName
	podName := nodeLabel // pod names are typically the same as node names

	cmd := exec.CommandContext(ctx, "kubectl", "exec", "-n", namespace, "-i", podName, "--", content)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ClabernetesProvider) Save(ctx context.Context,
	topologyFile string,
	onLog func(data string),
	onDone func(output *string, err error)) {
}
func (p *ClabernetesProvider) SaveOnNode(
	ctx context.Context,
	topologyFile string,
	nodeName string,
	onLog func(data string),
	onDone func(output *string, err error)) {
}
func (p *ClabernetesProvider) StreamContainerLogs(
	ctx context.Context,
	topologyFile string,
	containerID string,
	onLog func(data string),
) error {
	namespace := getTopologyName(topologyFile, onLog)
	cmd := exec.CommandContext(ctx, "kubectl", "logs", "-f", containerID, "-n", namespace)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go streamOutput(stdout, onLog)
	return cmd.Wait() //placeholder
}

func getTopologyName(topologyFile string, onLog func(data string)) string {
	content, err := os.ReadFile(topologyFile)
	if err != nil {
		onLog(fmt.Sprintf("failed to read topology file: %v", err))
		return ""
	}

	var meta TopologyMeta
	if err := yaml.Unmarshal(content, &meta); err != nil {
		onLog(fmt.Sprintf("failed to parse topology file: %v", err))
		return ""
	}

	return "c9s-" + meta.Name
}

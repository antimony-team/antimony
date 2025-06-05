package deployment

import (
	"context"
	"encoding/json"
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"os/exec"
)

type TopologyMeta struct {
	Name string `yaml:"name"`
}

type ClabernetesProvider struct{}

func (p *ClabernetesProvider) Deploy(
	ctx context.Context,
	topologyFile string,
	onLog func(string),
) (*string, error) {
	cmd := exec.CommandContext(ctx, "sh", "-c",
		"clabverter -t '"+topologyFile+"' --stdout --naming non-prefixed | kubectl apply -f -")
	return runClabCommandSync(cmd, onLog)
}

func (p *ClabernetesProvider) Redeploy(
	ctx context.Context,
	topologyFile string,
	onLog func(string),
) (*string, error) {
	cmd := exec.CommandContext(ctx, "docker", "start", "kind-control-plane")
	return runClabCommandSync(cmd, onLog)
}

func (p *ClabernetesProvider) Destroy(
	ctx context.Context,
	topologyFile string,
	onLog func(string),
) (*string, error) {
	namespace := getTopologyName(topologyFile, onLog)
	cmd := exec.CommandContext(ctx, "kubectl", "delete", "namespace", namespace)
	return runClabCommandSync(cmd, onLog)
}

func (p *ClabernetesProvider) Inspect(
	ctx context.Context,
	topologyFile string,
	onLog func(string),
) (InspectOutput, error) {
	namespace := getTopologyName(topologyFile, onLog)

	cmd := exec.CommandContext(ctx, "kubectl", "get", "pods", "-n", namespace, "-o", "json")
	raw, err := runClabCommandSync(cmd, onLog)
	if err != nil {
		return nil, err
	}

	if raw == nil || *raw == "" {
		return InspectOutput{}, nil
	}

	var result struct {
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
	if err := json.Unmarshal([]byte(*raw), &result); err != nil {
		return nil, fmt.Errorf("failed to parse pod list: %w", err)
	}

	var containers []InspectContainer
	for _, pod := range result.Items {
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
	return InspectOutput{}, nil
}

func (p *ClabernetesProvider) InspectAll( //not tested
	ctx context.Context,
) (InspectOutput, error) {
	/*cmd := exec.CommandContext(ctx, "kubectl", "get", "topology", "--all-namespaces", "-o", "json")
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

		return &InspectOutput{Containers: []InspectContainer{}}, nil
	}*/

	return InspectOutput{}, nil
}

func (p *ClabernetesProvider) Exec(
	ctx context.Context,
	topologyFile string,
	content string,
	onLog func(string),
	onDone func(*string, error),
) {
	// Optional: probably not needed
	onDone(nil, nil)
}

func (p *ClabernetesProvider) ExecOnNode(
	ctx context.Context,
	topologyFile string,
	content string,
	nodeLabel string,
	onLog func(string),
	onDone func(*string, error),
) {
	namespace := getTopologyName(topologyFile, onLog)
	cmd := exec.CommandContext(ctx, "kubectl", "exec", "-n", namespace, "-i", nodeLabel, "--", content)
	runClabCommand(cmd, onLog, onDone)
}

func (p *ClabernetesProvider) Save(ctx context.Context,
	topologyFile string,
	onLog func(string),
	onDone func(*string, error)) {
	onDone(nil, nil)
}

func (p *ClabernetesProvider) SaveOnNode(ctx context.Context,
	topologyFile string,
	nodeName string,
	onLog func(string),
	onDone func(*string, error)) {
	onDone(nil, nil)
}

func (p *ClabernetesProvider) StreamContainerLogs(
	ctx context.Context,
	topologyFile string,
	containerID string,
	onLog func(string),
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
	return cmd.Wait()
}

func getTopologyName(topologyFile string, onLog func(string)) string {
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

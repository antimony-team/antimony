package deployment

import "context"

type DeploymentProvider interface {
	// Deploy Deploys a lab
	Deploy(ctx context.Context, topologyFile string, onLog func(data string)) error

	// Destroy Destroys a lab
	Destroy(ctx context.Context, topologyFile string, onLog func(data string)) error

	// Inspect Returns inspect information for the lab
	Inspect(ctx context.Context, topologyFile string, onLog func(data string), onData func(data string)) error

	// Redeploy Destroys the lab and redeploys it
	Redeploy(ctx context.Context, topologyFile string, onLog func(data string)) error

	Exec(ctx context.Context, topologyFile string, content string, onLog func(data string)) error
	ExecOnNode(ctx context.Context, topologyFile string, content string, nodeName string, onLog func(data string)) error
	Save(ctx context.Context, topologyFile string, onLog func(data string)) error
	SaveOnNode(ctx context.Context, topologyFile string, nodeName string, onLog func(data string)) error
	StreamContainerLogs(ctx context.Context, topologyFile string, onLog func(data string)) error
}

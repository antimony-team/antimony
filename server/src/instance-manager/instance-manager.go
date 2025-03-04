package instance_manager

type InstanceCommand string

const (
	DestroyLab  InstanceCommand = "destroy-lab"
	RedeployLab InstanceCommand = "redeploy-lab"
	StartNode   InstanceCommand = "start-node"
	StopNode    InstanceCommand = "stop-node"
	SaveNode    InstanceCommand = "save-node"
)

type (
	InstanceManager interface {
		HandleCommand()
	}

	instanceManager struct {
	}
)

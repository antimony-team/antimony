package instance

type (
	InstanceManager interface {
		HandleCommand(command InstanceCommand) error
		GetInstanceForLab(labId string) *Instance
	}

	instanceManager struct {
		instances map[string]Instance
	}
)

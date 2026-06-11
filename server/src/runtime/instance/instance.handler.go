package instance

import (
	"antimonyBackend/auth"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
)

type (
	Handler interface{}

	handler struct {
		instanceService Service
		socketManager   socket.SocketManager

		commandsNamespace socket.InputNamespace[InstanceCommandData]
	}
)

func CreateHandler(
	instanceService Service,
	socketManager socket.SocketManager,
) Handler {
	instanceHandler := &handler{
		instanceService: instanceService,
		socketManager:   socketManager,
	}

	instanceHandler.commandsNamespace = socket.CreateInputNamespace[InstanceCommandData](
		socketManager, false, nil, instanceHandler.handleCommand, nil, "lab-commands",
	)

	return instanceHandler
}

func (s *handler) handleCommand(
	ctx context.Context,
	data *InstanceCommandData,
	authUser *auth.AuthenticatedUser,
	onResponse func(response utils.OkResponse[any]),
	onError func(response utils.ErrorResponse),
) {
	if data.LabId == nil || data.Command == nil {
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidSocketRequest))
		return
	}

	switch *data.Command {
	case InstanceCommands.Deploy:
		if err := s.instanceService.DeployLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.Destroy:
		if err := s.instanceService.DestroyLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.StartNode:
		if err := s.instanceService.StartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.StopNode:
		if err := s.instanceService.StopNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.RestartNode:
		if err := s.instanceService.RestartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.FetchShells:
		if shells, err := s.instanceService.FetchShellsCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shells))
		}
	case InstanceCommands.OpenShell:
		if shellId, err := s.instanceService.OpenShellCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shellId))
		}
	case InstanceCommands.CloseShell:
		if err := s.instanceService.CloseShellCommand(data.ShellId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidLabCommand))
	}
}

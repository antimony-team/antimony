package instance

import (
	"antimonyBackend/auth"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
)

type (
	handler struct {
		instanceService Service
		socketManager   socket.Manager

		commandsNamespace socket.InputNamespace[InstanceCommandData]
	}
)

func CreateHandler(
	instanceService Service,
	socketManager socket.Manager,
) {
	instanceHandler := &handler{
		instanceService: instanceService,
		socketManager:   socketManager,
	}

	instanceHandler.commandsNamespace = socket.CreateInputNamespace[InstanceCommandData](
		socketManager, false, nil, instanceHandler.handleCommand, nil, "lab-commands",
	)
}

func (h *handler) handleCommand(
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
		if err := h.instanceService.DeployLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.Destroy:
		if err := h.instanceService.DestroyLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.StartNode:
		if err := h.instanceService.StartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.StopNode:
		if err := h.instanceService.StopNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.RestartNode:
		if err := h.instanceService.RestartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.FetchShells:
		if shells, err := h.instanceService.FetchShellsCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shells))
		}
	case InstanceCommands.OpenShell:
		if shellId, err := h.instanceService.OpenShellCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shellId))
		}
	case InstanceCommands.CloseShell:
		if err := h.instanceService.CloseShellCommand(data.ShellId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidLabCommand))
	}
}

package instance

import (
	"antimonyBackend/auth"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
)

type handler struct {
	service       *Service
	socketManager *socket.Manager

	commandsNamespace *socket.InputNamespace[InstanceCommandData]
}

func CreateHandler(
	service *Service,
	socketManager *socket.Manager,
) {
	instanceHandler := &handler{
		service:       service,
		socketManager: socketManager,
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
		if err := h.service.DeployLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.Destroy:
		if err := h.service.DestroyLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.StartNode:
		if err := h.service.StartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.StopNode:
		if err := h.service.StopNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.RestartNode:
		if err := h.service.RestartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case InstanceCommands.FetchShells:
		if shells, err := h.service.FetchShellsCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shells))
		}
	case InstanceCommands.OpenShell:
		if shellId, err := h.service.OpenShellCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shellId))
		}
	case InstanceCommands.CloseShell:
		if err := h.service.CloseShellCommand(data.ShellId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidLabCommand))
	}
}

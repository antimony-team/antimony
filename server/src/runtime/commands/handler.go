package commands

import (
	"antimonyBackend/auth"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/runtime/shell"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
)

type handler struct {
	shellService    *shell.Service
	instanceService *instance.Service

	socketManager *socket.Manager

	commandsNamespace *socket.InputNamespace[commandPayload]
}

func CreateHandler(
	shellService *shell.Service,
	instanceService *instance.Service,
	socketManager *socket.Manager,
) {
	instanceHandler := &handler{
		shellService:    shellService,
		instanceService: instanceService,
		socketManager:   socketManager,
	}

	instanceHandler.commandsNamespace = socket.CreateInputNamespace[commandPayload](
		socketManager, false, nil, instanceHandler.handleCommand, nil, "cmd",
	)
}

func (h *handler) handleCommand(
	ctx context.Context,
	data *commandPayload,
	authUser *auth.AuthenticatedUser,
	onResponse func(response utils.OkResponse[any]),
	onError func(response utils.ErrorResponse),
) {
	if data.Command == nil || data.LabId == nil {
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidSocketRequest))
		return
	}

	switch *data.Command {
	case runtimeCommands.DeployLab:
		if err := h.instanceService.DeployLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case runtimeCommands.DestroyLab:
		if err := h.instanceService.DestroyLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case runtimeCommands.StartNode:
	case runtimeCommands.StopNode:
	case runtimeCommands.RestartNode:
		h.handleNodeCommand(ctx, data, authUser, onError, onResponse)
	case runtimeCommands.FetchShells:
	case runtimeCommands.OpenShell:
	case runtimeCommands.CloseShell:
		h.handleShellCommand(ctx, data, authUser, onError, onResponse)
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidRuntimeCommand))
	}
}

func (h *handler) handleNodeCommand(
	ctx context.Context,
	data *commandPayload,
	authUser *auth.AuthenticatedUser,
	onError func(errorResponse utils.ErrorResponse),
	onResponse func(response utils.OkResponse[any]),
) {
	if data.Node == nil {
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidSocketRequest))
		return
	}

	switch *data.Command {
	case runtimeCommands.StartNode:
		if err := h.instanceService.StartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case runtimeCommands.StopNode:
		if err := h.instanceService.StopNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case runtimeCommands.RestartNode:
		if err := h.instanceService.RestartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidRuntimeCommand))
	}
}

func (h *handler) handleShellCommand(
	ctx context.Context,
	data *commandPayload,
	authUser *auth.AuthenticatedUser,
	onError func(errorResponse utils.ErrorResponse),
	onResponse func(response utils.OkResponse[any]),
) {
	switch *data.Command {
	case runtimeCommands.FetchShells:
		if shells, err := h.shellService.FetchShellsCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shells))
		}
	case runtimeCommands.OpenShell:
		if shellId, err := h.shellService.OpenShellCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shellId))
		}
	case runtimeCommands.CloseShell:
		if err := h.shellService.CloseShellCommand(data.ShellId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidRuntimeCommand))
	}
}

package commands

type commandPayload struct {
	LabId   *string         `json:"labId"`
	Command *RuntimeCommand `json:"command"`
	Node    *string         `json:"node"`
	ShellId *string         `json:"shellId"`
}

type RuntimeCommand int

const (
	deployLabCommand RuntimeCommand = iota
	destroyLabCommand
	startNodeCommand
	stopNodeCommand
	restartNodeCommand
	fetchShellsCommand
	openShellCommand
	closeShellCommand
)

var runtimeCommands = struct {
	DeployLab   RuntimeCommand
	DestroyLab  RuntimeCommand
	StopNode    RuntimeCommand
	StartNode   RuntimeCommand
	RestartNode RuntimeCommand
	FetchShells RuntimeCommand
	OpenShell   RuntimeCommand
	CloseShell  RuntimeCommand
}{
	DeployLab:   deployLabCommand,
	DestroyLab:  destroyLabCommand,
	StopNode:    stopNodeCommand,
	StartNode:   startNodeCommand,
	RestartNode: restartNodeCommand,
	FetchShells: fetchShellsCommand,
	OpenShell:   openShellCommand,
	CloseShell:  closeShellCommand,
}

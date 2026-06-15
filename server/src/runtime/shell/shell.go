package shell

type shellData struct {
	Id   string `json:"id"`
	Node string `json:"node"`
}

type shellControlData struct {
	LabId   string       `json:"labId"`
	Command shellCommand `json:"command"`
	Node    string       `json:"node"`
	ShellId string       `json:"shellId"`
	Message string       `json:"message"`
}

type shellCommand int

const (
	shellError shellCommand = iota
	shellClose
)

var ShellCommands = struct {
	Error shellCommand
	Close shellCommand
}{
	Error: shellError,
	Close: shellClose,
}


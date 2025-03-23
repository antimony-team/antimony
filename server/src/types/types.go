package types

type Severity int

const (
	Success Severity = iota
	Info
	Warning
	Error
	Fatal
)

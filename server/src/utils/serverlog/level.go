package serverlog

type LogLevel int

const (
	SuccessLevel LogLevel = iota
	InfoLevel
	WarningLevel
	ErrorLevel
	FatalLevel
)

func (s LogLevel) String() string {
	return [...]string{"SUCCESS", "INFO", "WARNING", "ERROR", "FATAL"}[s]
}

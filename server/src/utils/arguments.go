package utils

import "flag"

type CommandLineArguments struct {
	ConfigFile       *string
	UseLocalDatabase *bool
	DevelopmentMode  *bool
}

func ParseArguments() *CommandLineArguments {
	cmdArgs := &CommandLineArguments{
		flag.String("config", "./config.default.yml", "Path to the configuration file"),
		flag.Bool("sqlite", false, "Whether to use the local SQLite database"),
		flag.Bool("dev", false, "Whether to start Antimony in development mode"),
	}
	flag.Parse()

	return cmdArgs
}

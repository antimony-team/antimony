package utils

import "flag"

type CommandLineArguments struct {
	ConfigFile       *string
	UseLocalDatabase *bool
}

func ParseArguments() *CommandLineArguments {
	cmdArgs := &CommandLineArguments{
		flag.String("config", "./config.yml", "Path to the configuration file"),
		flag.Bool("local-db", false, "Whether to use the local SQLite database"),
	}
	flag.Parse()

	return cmdArgs
}

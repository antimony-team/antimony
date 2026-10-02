package sshserver

import (
	"errors"
	"fmt"
	"path"
	"strings"
)

// tcpdumpArgumentOptions are the short options of tcpdump that take an argument. They are needed to tell an
// argument apart from a group of flags, e.g. "-w -" from "-nU".
const tcpdumpArgumentOptions = "BcCEFGijmMQrsTVwWyzZ"

// parseCaptureCommand returns the interface a capture command asks for. The command is either just the interface
// name or a tcpdump command line like the one Wireshark's sshdump sends ("tcpdump -U -i eth0 -w -", optionally
// run through sudo), whose -i option names the interface. All other tcpdump options are ignored.
func parseCaptureCommand(args []string) (string, error) {
	if len(args) > 0 && args[0] == "sudo" {
		args = args[1:]
	}

	if len(args) == 0 {
		return "", errors.New("missing interface to capture")
	}

	if path.Base(args[0]) != "tcpdump" {
		if len(args) > 1 {
			return "", fmt.Errorf("unexpected arguments %q, expected an interface name or a tcpdump command", args[1:])
		}
		return args[0], nil
	}

	for i := 1; i < len(args); i++ {
		arg := args[i]

		if value, ok := strings.CutPrefix(arg, "--interface="); ok {
			return value, nil
		}
		if arg == "--interface" {
			if i+1 < len(args) {
				return args[i+1], nil
			}
			break
		}
		if !strings.HasPrefix(arg, "-") || strings.HasPrefix(arg, "--") || arg == "-" {
			continue
		}

		// A group of short options, where an option that takes an argument consumes the rest of the group, or the
		// next argument if it is the last one.
		for j := 1; j < len(arg); j++ {
			option := arg[j]
			if !strings.ContainsRune(tcpdumpArgumentOptions, rune(option)) {
				continue
			}

			value := arg[j+1:]
			if value == "" && i+1 < len(args) {
				i++
				value = args[i]
			}

			if option == 'i' && value != "" {
				return value, nil
			}
			break
		}
	}

	return "", errors.New("the tcpdump command has no interface (-i)")
}

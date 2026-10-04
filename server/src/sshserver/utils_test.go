package sshserver

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * parseCaptureCommand
 */

func TestParseCaptureCommand_AcceptsAnInterfaceOrATcpdumpCommand(t *testing.T) {
	cases := map[string]struct {
		args     []string
		expected string
	}{
		"bare interface":          {[]string{"eth0"}, "eth0"},
		"separate -i":             {[]string{"tcpdump", "-i", "eth1"}, "eth1"},
		"attached -i":             {[]string{"tcpdump", "-ieth1"}, "eth1"},
		"sshdump default":         {[]string{"tcpdump", "-U", "-i", "e1-1", "-w", "-"}, "e1-1"},
		"through sudo":            {[]string{"sudo", "tcpdump", "-U", "-i", "eth0", "-w", "-"}, "eth0"},
		"absolute path":           {[]string{"/usr/sbin/tcpdump", "-i", "eth0"}, "eth0"},
		"grouped flags":           {[]string{"tcpdump", "-nUi", "eth2", "-w", "-"}, "eth2"},
		"long option with equals": {[]string{"tcpdump", "--interface=eth0"}, "eth0"},
		"long option":             {[]string{"tcpdump", "--interface", "eth0"}, "eth0"},
		"options before -i":       {[]string{"tcpdump", "-s", "0", "-w", "-", "-i", "eth3"}, "eth3"},
		"capture filter after":    {[]string{"tcpdump", "-i", "eth0", "-w", "-", "not", "port", "22"}, "eth0"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			interfaceName, err := parseCaptureCommand(c.args)

			require.NoError(t, err)
			assert.Equal(t, c.expected, interfaceName)
		})
	}
}

func TestParseCaptureCommand_RejectsCommandsWithoutAnInterface(t *testing.T) {
	cases := map[string][]string{
		"empty":                     {},
		"only sudo":                 {"sudo"},
		"several interfaces":        {"eth0", "eth1"},
		"tcpdump without -i":        {"tcpdump", "-U", "-w", "-"},
		"-i without value":          {"tcpdump", "-i"},
		"-i consumed by -w":         {"tcpdump", "-w", "-i"},
		"--interface without value": {"tcpdump", "--interface"},
	}

	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := parseCaptureCommand(args)

			assert.Error(t, err)
		})
	}
}

package sshserver

import (
	"slices"
	"strings"
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
		"empty":                      {},
		"only sudo":                  {"sudo"},
		"several interfaces":         {"eth0", "eth1"},
		"tcpdump without -i":         {"tcpdump", "-U", "-w", "-"},
		"-i without value":           {"tcpdump", "-i"},
		"-i consumed by -w":          {"tcpdump", "-w", "-i"},
		"--interface without value":  {"tcpdump", "--interface"},
		"--interface= without value": {"tcpdump", "--interface="},
	}

	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := parseCaptureCommand(args)

			assert.Error(t, err)
		})
	}
}

// FuzzParseCaptureCommand checks that the interface always comes from the command a client sent, and that no
// command makes the parser fail in another way than with an error.
func FuzzParseCaptureCommand(f *testing.F) {
	for _, seed := range []string{
		"eth1",
		"tcpdump -U -i eth0 -w -",
		"sudo /usr/sbin/tcpdump -nUi e1-1 -w -",
		"tcpdump --interface=eth2",
		"tcpdump --interface eth3",
		"tcpdump --interface=",
		"tcpdump -w - -i",
		"tcpdump -iw",
		"sudo",
		"",
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, command string) {
		args := strings.Fields(command)

		interfaceName, err := parseCaptureCommand(args)
		if err != nil {
			return
		}

		require.NotEmpty(t, interfaceName, "the command %q gives an empty interface", command)

		comesFromAnArgument := slices.ContainsFunc(args, func(arg string) bool {
			return strings.HasSuffix(arg, interfaceName)
		})
		require.Truef(t, comesFromAnArgument, "%q isn't taken from the command %q", interfaceName, command)
	})
}

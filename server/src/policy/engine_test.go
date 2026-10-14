package policy

import (
	"antimonyBackend/clabtypes"
	"fmt"
	"reflect"
	"strings"
	"testing"

	clablinks "github.com/srl-labs/containerlab/links"
	clab "github.com/srl-labs/containerlab/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// parseTopology decodes a definition the way schema.Service.Parse does before the engine checks it:
// once generically and once into containerlab's types.
func parseTopology(t testing.TB, definition string) (any, *clab.Topology) {
	t.Helper()

	var node yaml.Node
	require.NoError(t, yaml.Unmarshal([]byte(definition), &node))

	var typed clabtypes.TopologyDefinition
	require.NoError(t, node.Decode(&typed))

	var raw any
	require.NoError(t, node.Decode(&raw))

	return raw, typed.Topology
}

// checkTopology runs every rule on a definition without the cache.
func checkTopology(t testing.TB, options Options, definition string, bindFiles ...string) []Finding {
	t.Helper()

	raw, typed := parseTopology(t, definition)
	return CreateEngine(options).check(raw, typed, definition, bindFiles)
}

// findingKeys returns the findings as "rule@path", which is what most tests compare.
func findingKeys(findings []Finding) []string {
	keys := make([]string, 0, len(findings))
	for _, finding := range findings {
		keys = append(keys, fmt.Sprintf("%s@%s", finding.RuleId, finding.Path))
	}
	return keys
}

// nodeTopology wraps the lines of a node definition into a topology with a single node "n".
func nodeTopology(lines ...string) string {
	return "name: test\ntopology:\n  nodes:\n    n:\n      kind: linux\n" + indent(lines, 6)
}

func indent(lines []string, spaces int) string {
	var builder strings.Builder
	for _, line := range lines {
		builder.WriteString(strings.Repeat(" ", spaces) + line + "\n")
	}
	return builder.String()
}

const cleanTopology = `# A lab that only uses its own nodes and files
name: clean
topology:
  defaults:
    env:
      MODE: lab
  kinds:
    nokia_srlinux:
      image: ghcr.io/nokia/srlinux:24.10
      startup-config: configs/srl.cfg
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
      binds:
        - configs/srl2:/opt/configs:ro
    client:
      kind: linux
      image: alpine:3.20
      exec:
        - ip link set eth1 up
      stages:
        create:
          exec:
            - command: echo inside
              target: container
  links:
    - endpoints: ["srl1:e1-1", "srl2:e1-1"]
    - endpoints:
        - {node: srl1, interface: e1-2}
        - {node: client, interface: eth1}
      type: veth
    - type: dummy
      endpoint: {node: client, interface: eth2}
`

var cleanBindFiles = []string{"configs/srl.cfg", "configs/srl2/startup.cfg"}

func TestCheck_CleanTopologyHasNoFindings(t *testing.T) {
	assert.Empty(t, checkTopology(t, Options{}, cleanTopology, cleanBindFiles...))
}

func TestCheck_RootKeys(t *testing.T) {
	cases := map[string]struct {
		definition string
		expected   []string
	}{
		"name and debug are allowed": {
			definition: "name: a\ndebug: true\ntopology:\n  nodes: {}\n",
			expected:   []string{},
		},
		"mgmt is set by Antimony": {
			definition: "name: a\nmgmt:\n  network: custom\ntopology:\n  nodes: {}\n",
			expected:   []string{"mgmt@mgmt"},
		},
		"prefix is set by Antimony": {
			definition: "name: a\nprefix: \"\"\ntopology:\n  nodes: {}\n",
			expected:   []string{"prefix@prefix"},
		},
		"settings can reference server files": {
			definition: "name: a\nsettings: {}\ntopology:\n  nodes: {}\n",
			expected:   []string{"settings@settings"},
		},
		"unknown root keys are not reviewed": {
			definition: "name: a\nbogus: 1\ntopology:\n  nodes: {}\n",
			expected:   []string{"unreviewed-field@bogus"},
		},
		"unknown topology sections are not reviewed": {
			definition: "name: a\ntopology:\n  nodes: {}\n  extra: {}\n",
			expected:   []string{"unreviewed-field@topology.extra"},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			assert.ElementsMatch(t, testCase.expected, findingKeys(checkTopology(t, Options{}, testCase.definition)))
		})
	}
}

// containerlab renders the whole file as a Go template and expands environment variables before it
// parses it, so these are found anywhere in the text, comments included.
func TestCheck_RawText(t *testing.T) {
	cases := map[string]struct {
		definition string
		expected   []string
	}{
		"a template in a value": {
			definition: "name: \"{{ .Name }}\"\ntopology:\n  nodes: {}\n",
			expected:   []string{"go-template@"},
		},
		"a template in a comment": {
			definition: "# {{ .unused }}\nname: a\ntopology:\n  nodes: {}\n",
			expected:   []string{"go-template@"},
		},
		"a braced environment variable": {
			definition: nodeTopology("env:", "  KEY: ${SECRET}"),
			expected:   []string{"env-expansion@"},
		},
		"a plain environment variable": {
			definition: nodeTopology("env:", "  KEY: $SECRET"),
			expected:   []string{"env-expansion@"},
		},
		"a dollar before a digit": {
			definition: nodeTopology("env:", "  KEY: price $5"),
			expected:   []string{},
		},
		"a lone dollar": {
			definition: nodeTopology("env:", "  KEY: \"$\""),
			expected:   []string{},
		},
		"both at once": {
			definition: "# {{ x }}\n" + nodeTopology("env:", "  KEY: ${SECRET}"),
			expected:   []string{"go-template@", "env-expansion@"},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			assert.ElementsMatch(t, testCase.expected, findingKeys(checkTopology(t, Options{}, testCase.definition)))
		})
	}
}

// deniedFieldValues holds a value for every denied node field, so the test below covers all of them.
var deniedFieldValues = map[string]string{
	"env-files":     "[configs/lab.env]",
	"network-mode":  "host",
	"pid-mode":      "host",
	"cgroupns-mode": "host",
	"cgroup-parent": "/system.slice",
	"cap-add":       "[NET_ADMIN]",
	"devices":       "[/dev/net/tun]",
	"security-opts": "[seccomp=unconfined]",
	"sysctls":       "{net.ipv4.ip_forward: 1}",
	"runtime":       "docker",
	"ports":         "[\"127.0.0.1:8080:80\"]",
	"volumes":       "[data:/data]",
	"mgmt-ipv4":     "172.20.20.250",
	"mgmt-ipv6":     "\"2001:db8::1\"",
	"extras":        "{}",
	"components":    "[]",
}

func TestCheck_EveryDeniedNodeFieldIsReported(t *testing.T) {
	for key, field := range nodeFields {
		if !field.isDenied {
			continue
		}

		t.Run(key, func(t *testing.T) {
			value, ok := deniedFieldValues[key]
			require.Truef(t, ok, "denied field %q needs a value in deniedFieldValues", key)

			findings := checkTopology(t, Options{}, nodeTopology(key+": "+value))

			require.Len(t, findings, 1)
			assert.Equal(t, field.ruleId, findings[0].RuleId)
			assert.Equal(t, field.impact, findings[0].Impact)
			assert.Equal(t, "topology.nodes.n."+key, findings[0].Path)
			assert.Equal(t, field.message, findings[0].Message)
		})
	}
}

// Denied fields are reported wherever they are set, as defaults, kinds and groups apply to nodes.
func TestCheck_DeniedFieldsInEveryNodeDefinition(t *testing.T) {
	definition := `name: a
topology:
  defaults:
    cap-add: [NET_ADMIN]
  kinds:
    linux:
      ports: ["8080:80"]
  groups:
    spines:
      sysctls: {net.ipv4.ip_forward: 1}
  nodes:
    n:
      kind: linux
      group: spines
      runtime: podman
`
	assert.ElementsMatch(t, []string{
		"privileges@topology.defaults.cap-add",
		"host-ports@topology.kinds.linux.ports",
		"kernel-settings@topology.groups.spines.sysctls",
		"runtime@topology.nodes.n.runtime",
	}, findingKeys(checkTopology(t, Options{}, definition)))
}

func TestCheck_UnknownNodeFieldsAreNotReviewed(t *testing.T) {
	definition := `name: a
topology:
  defaults:
    future-field: 1
  nodes:
    n:
      kind: linux
      custom-prompt: true
`
	assert.ElementsMatch(t, []string{
		"unreviewed-field@topology.defaults.future-field",
		"unreviewed-field@topology.nodes.n.custom-prompt",
	}, findingKeys(checkTopology(t, Options{}, definition)))
}

// A new field in containerlab must not slip through: the allowlist has to name every field of its
// node definition, either as allowed or as denied.
func TestNodeFields_CoverEveryContainerlabNodeField(t *testing.T) {
	definitionType := reflect.TypeFor[clab.NodeDefinition]()

	for field := range definitionType.Fields() {
		tag, _, _ := strings.Cut(field.Tag.Get("yaml"), ",")
		if tag == "" || tag == "-" {
			continue
		}

		_, isListed := nodeFields[tag]
		assert.Truef(t, isListed, "containerlab's node field %q is missing from nodeFields", tag)
	}
}

// The allowlist must not name fields containerlab doesn't have at node level either, they would be
// neither reported as unreviewed nor checked.
func TestNodeFields_OnlyNameContainerlabNodeFields(t *testing.T) {
	containerlabFields := map[string]bool{}
	for field := range reflect.TypeFor[clab.NodeDefinition]().Fields() {
		tag, _, _ := strings.Cut(field.Tag.Get("yaml"), ",")
		containerlabFields[tag] = true
	}

	for key := range nodeFields {
		assert.Truef(t, containerlabFields[key], "nodeFields names %q, which isn't a containerlab node field", key)
	}
}

// Fields that only exist under credentials or on the management network aren't node fields.
func TestCheck_FieldsThatArentNodeFieldsAreNotReviewed(t *testing.T) {
	definition := nodeTopology("username: admin", "password: admin", "identity-file: /etc/shadow", "mgmt-net: custom")

	assert.ElementsMatch(t, []string{
		"unreviewed-field@topology.nodes.n.username",
		"unreviewed-field@topology.nodes.n.password",
		"unreviewed-field@topology.nodes.n.identity-file",
		"unreviewed-field@topology.nodes.n.mgmt-net",
	}, findingKeys(checkTopology(t, Options{}, definition)))
}

func TestCheck_HostReachingKinds(t *testing.T) {
	for _, kind := range hostReachingKinds {
		t.Run(kind, func(t *testing.T) {
			definition := "name: a\ntopology:\n  nodes:\n    n:\n      kind: " + kind + "\n"
			assert.Equal(t, []string{"host-kind@topology.nodes.n.kind"},
				findingKeys(checkTopology(t, Options{}, definition)))
		})
	}

	t.Run("the kind is matched without case and surrounding spaces", func(t *testing.T) {
		definition := "name: a\ntopology:\n  kinds:\n    \" Host \":\n      image: x\n  nodes:\n    n:\n      kind: \" Host \"\n"
		assert.Equal(t, []string{"host-kind@topology.nodes.n.kind"},
			findingKeys(checkTopology(t, Options{}, definition)))
	})

	t.Run("a kind set by the defaults is reported there", func(t *testing.T) {
		definition := "name: a\ntopology:\n  defaults:\n    kind: bridge\n  nodes:\n    n: {}\n"
		assert.Equal(t, []string{"host-kind@topology.defaults.kind"},
			findingKeys(checkTopology(t, Options{}, definition)))
	})

	t.Run("lab kinds are fine", func(t *testing.T) {
		definition := "name: a\ntopology:\n  nodes:\n    n:\n      kind: nokia_srlinux\n"
		assert.Empty(t, checkTopology(t, Options{}, definition))
	})
}

func TestCheck_ImageAllowlist(t *testing.T) {
	options := Options{AllowedImagePrefixes: []string{"ghcr.io/nokia/", "alpine:"}}

	cases := map[string]struct {
		image    string
		expected []string
	}{
		"an image with an allowed prefix": {image: "ghcr.io/nokia/srlinux:24.10", expected: []string{}},
		"another allowed prefix":          {image: "alpine:3.20", expected: []string{}},
		"surrounding spaces are ignored":  {image: "\"  alpine:3.20  \"", expected: []string{}},
		"an image without an allowed prefix": {
			image:    "registry.example.com/evil:latest",
			expected: []string{"image-not-allowed@topology.nodes.n.image"},
		},
		"a prefix must match from the start": {
			image:    "evil.io/ghcr.io/nokia/srlinux",
			expected: []string{"image-not-allowed@topology.nodes.n.image"},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			findings := checkTopology(t, options, nodeTopology("image: "+testCase.image))
			assert.ElementsMatch(t, testCase.expected, findingKeys(findings))
		})
	}

	t.Run("without an allowlist every image is allowed", func(t *testing.T) {
		assert.Empty(t, checkTopology(t, Options{}, nodeTopology("image: registry.example.com/evil:latest")))
	})

	t.Run("images of kinds and defaults are checked as well", func(t *testing.T) {
		definition := "name: a\ntopology:\n  defaults:\n    image: evil:1\n  kinds:\n    linux:\n      image: evil:2\n  nodes:\n    n:\n      kind: linux\n"
		assert.ElementsMatch(t, []string{
			"image-not-allowed@topology.defaults.image",
			"image-not-allowed@topology.kinds.linux.image",
		}, findingKeys(checkTopology(t, options, definition)))
	})
}

func TestCheck_Privileged(t *testing.T) {
	assert.Equal(t, []string{"privileged@topology.nodes.n.privileged"},
		findingKeys(checkTopology(t, Options{}, nodeTopology("privileged: true"))))

	assert.Empty(t, checkTopology(t, Options{}, nodeTopology("privileged: false")),
		"turning privileged off is safe")

	definition := "name: a\ntopology:\n  kinds:\n    linux:\n      privileged: true\n  nodes:\n    n:\n      kind: linux\n      privileged: false\n"
	assert.Equal(t, []string{"privileged@topology.kinds.linux.privileged"},
		findingKeys(checkTopology(t, Options{}, definition)),
		"a kind that is privileged is reported even if the node turns it off again")
}

func TestCheck_FileReferences(t *testing.T) {
	bindFiles := []string{"configs/r1.cfg", "configs/certs/key.pem", "license.key"}

	cases := map[string]struct {
		lines    []string
		expected []string
	}{
		"a bind of one of the topology's files": {
			lines:    []string{"binds:", "  - configs/r1.cfg:/etc/r1.cfg:ro"},
			expected: []string{},
		},
		"a bind of a directory with the topology's files": {
			lines:    []string{"binds:", "  - configs:/etc/configs"},
			expected: []string{},
		},
		"a bind of a path that cleans to one of the topology's files": {
			lines:    []string{"binds:", "  - configs/./certs/../r1.cfg:/etc/r1.cfg"},
			expected: []string{},
		},
		"an absolute bind": {
			lines:    []string{"binds:", "  - /etc/shadow:/mnt/shadow:ro"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a bind that leaves the topology directory": {
			lines:    []string{"binds:", "  - ../other-topology/r1.cfg:/mnt/r1.cfg"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a bind that leaves the topology directory and comes back": {
			lines:    []string{"binds:", "  - configs/../../x/configs/r1.cfg:/mnt/r1.cfg"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a bind of the home directory": {
			lines:    []string{"binds:", "  - ~/.ssh:/root/.ssh"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a bind of the whole topology directory": {
			lines:    []string{"binds:", "  - .:/mnt/topology"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a bind of a file the topology doesn't have": {
			lines:    []string{"binds:", "  - configs/r2.cfg:/etc/r2.cfg"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a bind that only shares a name prefix with a directory": {
			lines:    []string{"binds:", "  - conf:/etc/conf"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"a named docker volume": {
			lines:    []string{"binds:", "  - shared-volume:/data"},
			expected: []string{"foreign-file@topology.nodes.n.binds[0]"},
		},
		"every bind is checked on its own": {
			lines:    []string{"binds:", "  - configs/r1.cfg:/a", "  - /etc:/b", "  - license.key:/c", "  - ~/x:/d"},
			expected: []string{"foreign-file@topology.nodes.n.binds[1]", "foreign-file@topology.nodes.n.binds[3]"},
		},
		"a startup config of the topology": {
			lines:    []string{"startup-config: configs/r1.cfg"},
			expected: []string{},
		},
		"a foreign startup config": {
			lines:    []string{"startup-config: /etc/passwd"},
			expected: []string{"foreign-file@topology.nodes.n.startup-config"},
		},
		"a remote startup config": {
			lines:    []string{"startup-config: https://example.com/r1.cfg"},
			expected: []string{"remote-file@topology.nodes.n.startup-config"},
		},
		"an inline startup config": {
			lines:    []string{"startup-config: |", "  hostname r1", "  interface /etc/passwd"},
			expected: []string{},
		},
		"a license of the topology": {
			lines:    []string{"license: license.key"},
			expected: []string{},
		},
		"a foreign license": {
			lines:    []string{"license: /opt/licenses/srl.key"},
			expected: []string{"foreign-file@topology.nodes.n.license"},
		},
		"an identity file of the topology": {
			lines:    []string{"credentials:", "  identity-file: configs/certs/key.pem"},
			expected: []string{},
		},
		"a foreign identity file": {
			lines:    []string{"credentials:", "  identity-file: ~/.ssh/id_ed25519"},
			expected: []string{"foreign-file@topology.nodes.n.credentials.identity-file"},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			findings := checkTopology(t, Options{}, nodeTopology(testCase.lines...), bindFiles...)
			assert.ElementsMatch(t, testCase.expected, findingKeys(findings))
		})
	}

	// containerlab expands a leading ~ to the home directory of the server, so a bind file the
	// topology really has under that name must not make the reference look like its own.
	t.Run("a bind of the home directory is foreign even if the topology has a file of that name", func(t *testing.T) {
		findings := checkTopology(t, Options{}, nodeTopology("binds:", "  - ~/.ssh:/root/.ssh"), "~/.ssh")
		assert.Equal(t, []string{"foreign-file@topology.nodes.n.binds[0]"}, findingKeys(findings))
	})

	t.Run("without any bind files every reference is foreign", func(t *testing.T) {
		assert.Equal(t, []string{"foreign-file@topology.nodes.n.startup-config"},
			findingKeys(checkTopology(t, Options{}, nodeTopology("startup-config: configs/r1.cfg"))))
	})
}

func TestCheck_StageCommands(t *testing.T) {
	cases := map[string]struct {
		lines    []string
		expected []string
	}{
		"commands inside the node are fine": {
			lines: []string{
				"stages:",
				"  create:",
				"    exec:",
				"      - command: echo a",
				"        target: container",
			},
			expected: []string{},
		},
		"commands without a target run inside the node": {
			lines:    []string{"stages:", "  create:", "    exec:", "      - command: echo a"},
			expected: []string{},
		},
		"commands on the host are reported": {
			lines: []string{
				"stages:",
				"  configure:",
				"    exec:",
				"      - command: rm -rf /",
				"        target: host",
			},
			expected: []string{"host-exec@topology.nodes.n.stages.configure.exec[0].target"},
		},
		"the target is matched without case and surrounding spaces": {
			lines:    []string{"stages:", "  exit:", "    exec:", "      - command: x", "        target: \" HOST \""},
			expected: []string{"host-exec@topology.nodes.n.stages.exit.exec[0].target"},
		},
		"unknown targets fail closed": {
			lines:    []string{"stages:", "  healthy:", "    exec:", "      - command: x", "        target: server"},
			expected: []string{"host-exec@topology.nodes.n.stages.healthy.exec[0].target"},
		},
		"every stage is checked": {
			lines: []string{
				"stages:",
				"  create:",
				"    exec:",
				"      - command: a",
				"        target: host",
				"  create-links:",
				"    exec:",
				"      - command: b",
				"        target: host",
				"  configure:",
				"    exec:",
				"      - command: c",
				"        target: container",
				"      - command: d",
				"        target: host",
				"  healthy:",
				"    exec:",
				"      - command: e",
				"        target: host",
				"  exit:",
				"    exec:",
				"      - command: f",
				"        target: host",
			},
			expected: []string{
				"host-exec@topology.nodes.n.stages.create.exec[0].target",
				"host-exec@topology.nodes.n.stages.create-links.exec[0].target",
				"host-exec@topology.nodes.n.stages.configure.exec[1].target",
				"host-exec@topology.nodes.n.stages.healthy.exec[0].target",
				"host-exec@topology.nodes.n.stages.exit.exec[0].target",
			},
		},
		"the node's own exec runs inside it": {
			lines:    []string{"exec:", "  - ip link set eth1 up"},
			expected: []string{},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			assert.ElementsMatch(t, testCase.expected,
				findingKeys(checkTopology(t, Options{}, nodeTopology(testCase.lines...))))
		})
	}
}

func TestCheck_Links(t *testing.T) {
	cases := map[string]struct {
		links    []string
		expected []string
	}{
		"a brief link between nodes": {
			links:    []string{`- endpoints: ["a:eth1", "b:eth1"]`},
			expected: []string{},
		},
		"an extended veth link between nodes": {
			links: []string{
				"- type: veth",
				"  endpoints:",
				"    - {node: a, interface: eth1}",
				"    - {node: b, interface: eth1}",
			},
			expected: []string{},
		},
		"a dummy link": {
			links:    []string{"- type: dummy", "  endpoint: {node: a, interface: eth1}"},
			expected: []string{},
		},
		"a brief link to the host": {
			links:    []string{`- endpoints: ["a:eth1", "host:veth-a"]`},
			expected: []string{"host-link@topology.links[0]"},
		},
		"a brief link to the management network": {
			links:    []string{`- endpoints: ["a:eth1", "mgmt-net:veth-a"]`},
			expected: []string{"host-link@topology.links[0]"},
		},
		"a brief link to a macvlan": {
			links:    []string{`- endpoints: ["a:eth1", "macvlan:enp0s3"]`},
			expected: []string{"host-link@topology.links[0]"},
		},
		"an extended veth link to the management network": {
			links: []string{
				"- type: veth",
				"  endpoints:",
				"    - {node: a, interface: eth1}",
				"    - {node: mgmt-net, interface: veth-a}",
			},
			expected: []string{"host-link@topology.links[0].endpoints[1]"},
		},
		"an extended veth endpoint is matched without case and surrounding spaces": {
			links: []string{
				"- type: veth",
				"  endpoints:",
				"    - {node: \" HOST \", interface: veth-a}",
				"    - {node: a, interface: eth1}",
			},
			expected: []string{"host-link@topology.links[0].endpoints[0]"},
		},
		"a macvlan link": {
			links:    []string{"- type: macvlan", "  endpoint: {node: a, interface: eth1}", "  host-interface: enp0s3"},
			expected: []string{"host-link@topology.links[0]"},
		},
		"a host link": {
			links:    []string{"- type: host", "  endpoint: {node: a, interface: eth1}", "  host-interface: veth-a"},
			expected: []string{"host-link@topology.links[0]"},
		},
		"a mgmt-net link": {
			links: []string{
				"- type: mgmt-net",
				"  endpoint: {node: a, interface: eth1}",
				"  host-interface: veth-a",
			},
			expected: []string{"host-link@topology.links[0]"},
		},
		"a vxlan link": {
			links: []string{
				"- type: vxlan",
				"  endpoint: {node: a, interface: eth1}",
				"  remote: 10.0.0.1",
				"  vni: 100",
				"  udp-port: 4789",
			},
			expected: []string{"host-link@topology.links[0]"},
		},
		"only the links that leave the lab are reported": {
			links: []string{
				`- endpoints: ["a:eth1", "b:eth1"]`,
				`- endpoints: ["a:eth2", "host:veth-a"]`,
				"- type: dummy", "  endpoint: {node: b, interface: eth2}",
				"- type: macvlan", "  endpoint: {node: b, interface: eth3}", "  host-interface: enp0s3",
			},
			expected: []string{"host-link@topology.links[1]", "host-link@topology.links[3]"},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			definition := "name: a\ntopology:\n  nodes:\n    a: {kind: linux}\n    b: {kind: linux}\n  links:\n" +
				indent(testCase.links, 4)
			assert.ElementsMatch(t, testCase.expected, findingKeys(checkTopology(t, Options{}, definition)))
		})
	}
}

// containerlab's decoder turns brief links into their specific type, so a brief link only reaches the
// engine from links built in code. Like any type that isn't known to stay in the lab, it fails closed.
func TestCheck_LinksOfUnknownTypesFailClosed(t *testing.T) {
	links := []*clablinks.LinkDefinition{
		nil,
		{Type: string(clablinks.LinkTypeBrief)},
		{Type: string(clablinks.LinkTypeBrief), Link: &clablinks.LinkBriefRaw{Endpoints: []string{"a:eth1", "b:eth1"}}},
	}

	c := &checker{}
	c.checkLinks("topology.links", links)

	assert.Equal(t, []string{"host-link@topology.links[2]"}, findingKeys(c.findings),
		"missing links are skipped, a link of an unknown type is reported")
}

// A link containerlab can't decode makes the whole definition invalid, so the engine never sees it.
func TestParse_UnresolvableLinksAreRejectedBeforeTheCheck(t *testing.T) {
	definition := "name: a\ntopology:\n  nodes:\n    a: {kind: linux}\n  links:\n    - endpoints: [\"a:eth1\", \"a:eth2\", \"a:eth3\"]\n"

	var node yaml.Node
	require.NoError(t, yaml.Unmarshal([]byte(definition), &node))

	var typed clabtypes.TopologyDefinition
	assert.Error(t, node.Decode(&typed))
}

// Merge keys are resolved before the checks run, so a node gets what it merges in and the "<<" key
// itself is not reported as an unknown field.
func TestCheck_MergeKeysAreResolved(t *testing.T) {
	definition := `name: a
topology:
  groups:
    hidden: &hidden
      privileged: true
  nodes:
    merged:
      kind: linux
      <<: *hidden
`
	assert.ElementsMatch(t, []string{
		"privileged@topology.groups.hidden.privileged",
		"privileged@topology.nodes.merged.privileged",
	}, findingKeys(checkTopology(t, Options{}, definition)))
}

func TestCheck_FindingsAreDeterministic(t *testing.T) {
	definition := `name: a
mgmt: {network: x}
prefix: ""
topology:
  defaults: {cap-add: [A], devices: [/dev/x]}
  kinds:
    b: {privileged: true, ports: ["1:1"]}
    a: {privileged: true, runtime: x}
  nodes:
    z: {kind: a, volumes: [v:/v], binds: [/etc:/etc]}
    y: {kind: b, mgmt-ipv4: 1.1.1.1}
  links:
    - endpoints: ["y:eth1", "host:h1"]
    - endpoints: ["z:eth1", "host:h2"]
`
	first := checkTopology(t, Options{}, definition)
	require.NotEmpty(t, first)

	for range 20 {
		assert.Equal(t, first, checkTopology(t, Options{}, definition),
			"the findings must come in the same order every time")
	}
}

// policyTestTopology is a topology that uses about every unsafe feature at once.
const policyTestTopology = `# DO NOT DEPLOY: test input for the topology policy engine.
# The template marker below triggers go-template even though it is in a comment: {{ .unused }}
name: policy-test
prefix: ""
mgmt:
  network: policy-test-mgmt
settings: {}

topology:
  defaults:
    kind: linux
    env:
      TEST_VAR: ${ANTIMONY_POLICY_TEST}
  kinds:
    linux:
      image: alpine:3.20
      privileged: true
  groups:
    spines:
      cap-add: [NET_ADMIN]
    hidden: &hidden
      privileged: true
  nodes:
    clean:
      kind: linux
      image: alpine:3.20
      privileged: false
      binds:
        - configs/clean.cfg:/etc/clean.cfg:ro
      startup-config: |
        hostname clean
        interface eth1
    merged:
      kind: linux
      <<: *hidden
    files:
      binds:
        - /nonexistent/policy-test:/mnt/host:ro
        - ../other-topology/file.cfg:/mnt/other:ro
        - ~/policy-test:/mnt/home:ro
        - configs/clean.cfg:/etc/ok.cfg:ro
      startup-config: https://example.invalid/policy-test.cfg
      license: /nonexistent/license.key
      env-files: [configs/test.env]
    namespaces:
      network-mode: none
      pid-mode: "container:clean"
      sysctls:
        net.ipv4.ip_forward: 1
      ports: ["127.0.0.1:65001:80"]
      volumes: ["policy-test-volume:/data"]
      mgmt-ipv4: 172.20.20.250
      runtime: docker
    staged:
      stages:
        create:
          wait-for:
            - node: clean
              stage: create
          exec:
            - command: echo policy-test
              target: host
              phase: on-enter
            - command: echo inside
              target: container
              phase: on-exit
    kinded:
      kind: host
    grouped:
      group: spines
    unreviewed:
      kind: nokia_srlinux
      image: registry.example.invalid/image:latest
      custom-prompt: true
  links:
    - endpoints: ["clean:eth1", "files:eth1"]
    - endpoints: ["clean:eth2", "host:policytest0"]
    - type: macvlan
      endpoint: { node: clean, interface: eth3 }
      host-interface: policytest1
    - type: veth
      endpoints:
        - { node: clean, interface: eth4 }
        - { node: mgmt-net, interface: policytest2 }
    - type: dummy
      endpoint: { node: clean, interface: eth5 }
`

func TestCheck_PolicyTestTopology(t *testing.T) {
	findings := checkTopology(t, Options{AllowedImagePrefixes: []string{"alpine:"}}, policyTestTopology,
		"configs/clean.cfg", "configs/test.env")

	assert.ElementsMatch(t, []string{
		"go-template@",
		"env-expansion@",
		"mgmt@mgmt",
		"prefix@prefix",
		"settings@settings",
		"privileged@topology.kinds.linux.privileged",
		"privileges@topology.groups.spines.cap-add",
		"privileged@topology.groups.hidden.privileged",
		"privileged@topology.nodes.merged.privileged",
		"foreign-file@topology.nodes.files.binds[0]",
		"foreign-file@topology.nodes.files.binds[1]",
		"foreign-file@topology.nodes.files.binds[2]",
		"remote-file@topology.nodes.files.startup-config",
		"foreign-file@topology.nodes.files.license",
		"env-files@topology.nodes.files.env-files",
		"host-namespace@topology.nodes.namespaces.network-mode",
		"host-namespace@topology.nodes.namespaces.pid-mode",
		"kernel-settings@topology.nodes.namespaces.sysctls",
		"host-ports@topology.nodes.namespaces.ports",
		"volumes@topology.nodes.namespaces.volumes",
		"static-mgmt-address@topology.nodes.namespaces.mgmt-ipv4",
		"runtime@topology.nodes.namespaces.runtime",
		"host-exec@topology.nodes.staged.stages.create.exec[0].target",
		"host-kind@topology.nodes.kinded.kind",
		"image-not-allowed@topology.nodes.unreviewed.image",
		"unreviewed-field@topology.nodes.unreviewed.custom-prompt",
		"host-link@topology.links[1]",
		"host-link@topology.links[2]",
		"host-link@topology.links[3].endpoints[1]",
	}, findingKeys(findings))
}

func TestCheck_EveryFindingHasAKnownRuleAndImpact(t *testing.T) {
	findings := checkTopology(t, Options{AllowedImagePrefixes: []string{"alpine:"}}, policyTestTopology)
	require.NotEmpty(t, findings)

	for _, finding := range findings {
		assert.Contains(t, knownRules(), finding.RuleId)
		assert.Contains(t, knownImpacts(), finding.Impact)
		assert.NotEmpty(t, finding.Message)
	}
}

func TestNetlabFindings(t *testing.T) {
	findings := NetlabFindings()

	require.Len(t, findings, 1)
	assert.Equal(t, Rules.Netlab, findings[0].RuleId)
	assert.Equal(t, Impacts.Deploy, findings[0].Impact)
	assert.NotEmpty(t, findings[0].Message)
}

// The values are sent to the frontend and stored, so renaming one would break both.
func TestRuleIds_AreStable(t *testing.T) {
	assert.ElementsMatch(t, []RuleId{
		"netlab", "unreviewed-field", "go-template", "env-expansion", "mgmt", "prefix",
		"settings", "env-files", "host-kind", "image-not-allowed", "privileged", "privileges", "host-namespace",
		"kernel-settings", "runtime", "host-ports", "volumes", "static-mgmt-address", "host-exec", "remote-file",
		"foreign-file", "host-link",
	}, knownRules())
	assert.ElementsMatch(t, []Impact{"deploy", "shell", "unreviewed"}, knownImpacts())
}

// knownRules returns every rule of Rules.
func knownRules() []RuleId {
	return structValues[RuleId](Rules)
}

// knownImpacts returns every impact of Impacts.
func knownImpacts() []Impact {
	return structValues[Impact](Impacts)
}

func structValues[T any](value any) []T {
	reflected := reflect.ValueOf(value)
	values := make([]T, 0, reflected.NumField())
	for index := range reflected.NumField() {
		values = append(values, reflected.Field(index).Interface().(T))
	}
	return values
}

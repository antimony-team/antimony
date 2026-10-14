package policy

import (
	"antimonyBackend/clabtypes"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// fuzzSeeds are definitions that reach most of the rules, so the fuzzer starts from realistic input.
var fuzzSeeds = []string{
	cleanTopology,
	policyTestTopology,
	nodeTopology("privileged: true", "binds:", "  - /etc:/etc", "  - configs/a.cfg:/a"),
	nodeTopology("stages:", "  create:", "    exec:", "      - command: x", "        target: host"),
	nodeTopology("credentials:", "  identity-file: ~/.ssh/id"),
	"name: a\ntopology:\n  nodes:\n    a: {kind: host}\n  links:\n    - endpoints: [\"a:eth1\", \"host:h\"]\n",
	"name: a\ntopology:\n  links:\n    - type: macvlan\n      endpoint: {node: a, interface: e}\n      host-interface: x\n",
	"name: a\ntopology:\n  groups:\n    g: &g {cap-add: [A]}\n  nodes:\n    n: {<<: *g}\n",
	"{{ .x }} ${Y} $Z",
	"",
	"name: [unclosed",
	"- a\n- b\n",
	"topology: 1",
	"topology:\n  nodes: [1, 2]\n  links: {a: b}\n",
	"topology:\n  nodes:\n    n:\n      binds: {a: b}\n      stages: [x]\n",
}

// FuzzCheck decodes arbitrary input like schema.Service.Parse and checks it. The engine must cope with
// whatever the decoders produce, including the partial results of failed decodes, and must always
// return the same, well-formed findings for the same input.
func FuzzCheck(f *testing.F) {
	for _, seed := range fuzzSeeds {
		f.Add(seed, "configs/a.cfg")
	}

	f.Fuzz(func(t *testing.T, definition string, bindFile string) {
		var node yaml.Node
		_ = yaml.Unmarshal([]byte(definition), &node)

		var typed clabtypes.TopologyDefinition
		_ = node.Decode(&typed)

		var raw any
		_ = node.Decode(&raw)

		engine := CreateEngine(Options{AllowedImagePrefixes: []string{"alpine:"}})
		bindFiles := []string{bindFile}

		first := engine.check(raw, typed.Topology, definition, bindFiles)
		second := engine.check(raw, typed.Topology, definition, bindFiles)
		require.Equal(t, first, second, "the same input must give the same findings")

		rules, impacts := knownRules(), knownImpacts()
		for _, finding := range first {
			require.Contains(t, rules, finding.RuleId)
			require.Contains(t, impacts, finding.Impact)
			require.NotEmpty(t, finding.Message)
		}

		// The checks of the raw text don't depend on whether the definition decodes
		hasTemplate := slices.ContainsFunc(
			first,
			func(finding Finding) bool { return finding.RuleId == Rules.GoTemplate },
		)
		assert.Equal(t, strings.Contains(definition, "{{"), hasTemplate)
	})
}

// FuzzIsOwnFile checks that a file reference is only accepted if it stays inside the topology
// directory and names one of its files or a directory containing them.
func FuzzIsOwnFile(f *testing.F) {
	for _, seed := range [][2]string{
		{"configs/r1.cfg", "configs/r1.cfg"},
		{"configs", "configs/r1.cfg"},
		{"configs/../configs/r1.cfg", "configs/r1.cfg"},
		{"../configs/r1.cfg", "configs/r1.cfg"},
		{"/configs/r1.cfg", "configs/r1.cfg"},
		{"~/r1.cfg", "r1.cfg"},
		{".", "r1.cfg"},
		{"", ""},
		{"conf", "configs/r1.cfg"},
		{"configs//r1.cfg", "configs/r1.cfg"},
		{"a\\..\\b", "b"},
	} {
		f.Add(seed[0], seed[1])
	}

	f.Fuzz(func(t *testing.T, reference string, bindFile string) {
		c := &checker{bindFiles: []string{bindFile}}
		if !c.isOwnFile(reference) {
			return
		}

		cleaned := filepath.Clean(filepath.ToSlash(reference))

		require.Falsef(t, strings.HasPrefix(reference, "~"), "%q starts at the home directory", reference)
		require.Truef(t, filepath.IsLocal(cleaned), "%q leaves the topology directory", reference)
		require.NotEqualf(t, ".", cleaned, "%q is the whole topology directory", reference)
		require.Truef(t, bindFile == cleaned || strings.HasPrefix(bindFile, cleaned+"/"),
			"%q is neither %q nor a directory containing it", reference, bindFile)
	})
}

// FuzzCheckFileReference checks that every file reference gets at most one finding of the right kind.
func FuzzCheckFileReference(f *testing.F) {
	for _, seed := range []string{"configs/a.cfg", "https://x/y", "file:///etc/passwd", "/etc", "~", " configs/a.cfg "} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, reference string) {
		c := &checker{bindFiles: []string{"configs/a.cfg"}}
		c.checkFileReference("path", reference)

		require.LessOrEqual(t, len(c.findings), 1)

		if strings.Contains(strings.TrimSpace(reference), "://") {
			require.Len(t, c.findings, 1)
			require.Equal(t, Rules.RemoteFile, c.findings[0].RuleId)
		}
	})
}

// FuzzHashInput checks that the hash doesn't depend on the order of the bind files and only changes
// with the content.
func FuzzHashInput(f *testing.F) {
	f.Add("name: a", "a.cfg", "b.cfg")
	f.Add("", "", "")

	f.Fuzz(func(t *testing.T, definition string, first string, second string) {
		hash := hashInput(definition, []string{first, second})

		require.Equal(t, hash, hashInput(definition, []string{second, first}))
		require.Equal(t, hash, hashInput(definition, []string{first, second}))

		if first != second {
			require.NotEqual(t, hash, hashInput(definition, []string{first, first}))
		}
	})
}

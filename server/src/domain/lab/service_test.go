package lab

import (
	"antimonyBackend/utils"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestRenameDefinition_OnlyChangesTheName(t *testing.T) {
	const definition = `# A comment
name: old # the name
mgmt:
  network: custom
topology:
  kinds:
    linux: &linux
      image: alpine:3.20
  nodes:
    a:
      <<: *linux
  links:
    - endpoints: ["a:eth1", "a:eth2"]
`
	renamed, err := renameDefinition(definition, "new-1234")
	require.NoError(t, err)

	assert.Equal(t, `# A comment
name: new-1234 # the name
mgmt:
  network: custom
topology:
  kinds:
    linux: &linux
      image: alpine:3.20
  nodes:
    a:
      <<: *linux
  links:
    - endpoints: ["a:eth1", "a:eth2"]
`, renamed)
}

func TestRenameDefinition_AddsAMissingName(t *testing.T) {
	renamed, err := renameDefinition("topology: {}\n", "new")
	require.NoError(t, err)

	var parsed map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(renamed), &parsed))
	assert.Equal(t, "new", parsed["name"])
}

func TestRenameDefinition_RejectsDefinitionsThatArentMappings(t *testing.T) {
	for name, definition := range map[string]string{
		"empty":    "",
		"a list":   "- a\n- b\n",
		"a string": "just text\n",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := renameDefinition(definition, "new")
			assert.Error(t, err)
		})
	}
}

// FuzzRenameDefinition checks that renaming changes the name and nothing else, whatever the definition looks like.
// The definition is compared to itself written back without the rename, as yaml.v3 changes some rare constructs
// whenever it writes them, e.g. a null key becomes an empty string.
func FuzzRenameDefinition(f *testing.F) {
	for _, seed := range []string{
		"name: a\ntopology: {}\n",
		"# comment\nname: a # inline\nprefix: \"\"\n",
		"topology:\n  kinds:\n    k: &k {image: x}\n  nodes:\n    n: {<<: *k}\n",
		"name: &n shared\nother: *n\n",
		"name: [not, a, string]\n",
		"name: {nested: map}\n",
		"name: !!binary aGVsbG8=\n",
		"? complex\n: key\nname: a\n",
		"name: a\nname: b\n",
	} {
		f.Add(seed, "renamed-1234")
	}

	// Inputs the fuzzer found: a name with a line break, and a null key
	f.Add("0:", "\n")
	f.Add("?", "0")

	f.Fuzz(func(t *testing.T, definition string, name string) {
		renamed, err := renameDefinition(definition, name)
		if err != nil {
			return
		}

		var document yaml.Node
		require.NoError(t, yaml.Unmarshal([]byte(definition), &document))
		writtenBack, err := utils.EncodeYaml(&document)
		require.NoError(t, err)

		// Definitions that don't decode, e.g. because of a duplicate key, are rejected long before they're renamed
		var original any
		if yaml.Unmarshal([]byte(writtenBack), &original) != nil {
			return
		}

		var result any
		require.NoError(t, yaml.Unmarshal([]byte(renamed), &result), "the renamed definition must be valid YAML")

		originalFields := withoutName(t, original)
		resultFields := withoutName(t, result)

		require.Equal(t, name, nameOf(result), "the definition must have the new name")
		require.Equal(t, originalFields, resultFields, "everything but the name must stay as it was")
	})
}

// withoutName returns the top-level fields of a decoded definition without its name.
func withoutName(t *testing.T, definition any) map[any]any {
	t.Helper()

	fields := map[any]any{}
	switch mapping := definition.(type) {
	case map[string]any:
		for key, value := range mapping {
			fields[key] = value
		}
	case map[any]any:
		for key, value := range mapping {
			fields[key] = value
		}
	default:
		t.Fatalf("the definition is a %T, not a mapping", definition)
	}

	delete(fields, "name")
	return fields
}

func nameOf(definition any) any {
	switch mapping := definition.(type) {
	case map[string]any:
		return mapping["name"]
	case map[any]any:
		return mapping["name"]
	}
	return nil
}

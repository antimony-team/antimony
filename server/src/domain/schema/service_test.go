package schema

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony-server/clabtypes"
	"github.com/antimony-team/antimony-server/utils"
)

const (
	fallbackSchema = `{"type": "object", "required": ["source"]}`
	remoteSchema   = `{"type": "object", "required": ["remote"]}`
)

// writeFallback writes a fallback schema into a temporary file and returns its path.
func writeFallback(t *testing.T) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "schema.json")
	require.NoError(t, os.WriteFile(path, []byte(fallbackSchema), 0o600))
	return path
}

// requireSchema checks which of the two test schemas was loaded, by the field it requires.
func requireSchema(t *testing.T, schema *jsonschema.Schema, schemaString *string, expected string) {
	t.Helper()

	require.NotNil(t, schema)
	require.NotNil(t, schemaString)
	assert.Equal(t, expected, *schemaString)

	requiredField := "source"
	if expected == remoteSchema {
		requiredField = "remote"
	}
	require.NoError(t, schema.Validate(map[string]any{requiredField: 1}))
	assert.Error(t, schema.Validate(map[string]any{}))
}

func TestLoadSchema_UsesTheFallbackWithoutAUrl(t *testing.T) {
	schema, schemaString := loadSchema("", writeFallback(t), "test schema")
	requireSchema(t, schema, schemaString, fallbackSchema)
}

func TestLoadSchema_DownloadsTheRemoteSchema(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(remoteSchema))
	}))
	defer server.Close()

	schema, schemaString := loadSchema(server.URL, writeFallback(t), "test schema")
	requireSchema(t, schema, schemaString, remoteSchema)
}

func TestLoadSchema_FallsBackIfTheRemoteIsUnreachable(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	url := server.URL
	server.Close()

	schema, schemaString := loadSchema(url, writeFallback(t), "test schema")
	requireSchema(t, schema, schemaString, fallbackSchema)
}

// An error page used to be compiled as the schema, which failed and ended the server at startup.
func TestLoadSchema_FallsBackIfTheRemoteAnswersWithAnError(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusTooManyRequests, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte("<html>not a schema</html>"))
			}))
			defer server.Close()

			schema, schemaString := loadSchema(server.URL, writeFallback(t), "test schema")
			requireSchema(t, schema, schemaString, fallbackSchema)
		})
	}
}

func TestPointerToPath(t *testing.T) {
	cases := map[string]string{
		"":                               "",
		"/":                              "",
		"/name":                          "name",
		"/topology/nodes/srl1/kind":      "topology.nodes.srl1.kind",
		"/topology/links/0/endpoints/1":  "topology.links[0].endpoints[1]",
		"/0/1":                           "[0][1]",
		"/topology/nodes/a~1b/env/c~0d":  "topology.nodes.a/b.env.c~d",
		"/topology/nodes/a~01/kind":      "topology.nodes.a~1.kind",
		"/topology/nodes/r1.lab/binds/2": "topology.nodes.r1.lab.binds[2]",
	}

	for pointer, expected := range cases {
		t.Run(pointer, func(t *testing.T) {
			assert.Equal(t, expected, pointerToPath(pointer))
		})
	}
}

func TestDescribeValidationError(t *testing.T) {
	t.Run("an error at the root has no path", func(t *testing.T) {
		err := &jsonschema.ValidationError{InstanceLocation: "", Message: "missing properties: 'topology'"}
		assert.Equal(t, "missing properties: 'topology'", describeValidationError(err))
	})

	t.Run("the path of the field comes first", func(t *testing.T) {
		err := &jsonschema.ValidationError{
			InstanceLocation: "",
			Message:          "doesn't validate",
			Causes: []*jsonschema.ValidationError{
				{InstanceLocation: "/topology/links/0/endpoints/0", Message: "expected string, but got object"},
			},
		}
		assert.Equal(t, "topology.links[0].endpoints[0]: expected string, but got object", describeValidationError(err))
	})

	// A node is null or a map, so a map with an invalid field fails as "expected null" first
	t.Run("the cause of the deepest field wins over the first one", func(t *testing.T) {
		err := &jsonschema.ValidationError{
			InstanceLocation: "/topology/nodes/a",
			Message:          "oneOf failed",
			Causes: []*jsonschema.ValidationError{
				{InstanceLocation: "/topology/nodes/a", Message: "expected null, but got object"},
				{
					InstanceLocation: "/topology/nodes/a",
					Message:          "doesn't validate",
					Causes: []*jsonschema.ValidationError{
						{InstanceLocation: "/topology/nodes/a/kind", Message: "expected string, but got number"},
					},
				},
			},
		}
		assert.Equal(t, "topology.nodes.a.kind: expected string, but got number", describeValidationError(err))
	})

	t.Run("of equally deep causes the first one wins", func(t *testing.T) {
		err := &jsonschema.ValidationError{
			Causes: []*jsonschema.ValidationError{
				{InstanceLocation: "/a/b", Message: "first"},
				{InstanceLocation: "/c/d", Message: "second"},
			},
		}
		assert.Equal(t, "a.b: first", describeValidationError(err))
	})
}

func TestCauseAt(t *testing.T) {
	name := &jsonschema.ValidationError{InstanceLocation: "/name", Message: "does not match pattern"}
	err := &jsonschema.ValidationError{
		Causes: []*jsonschema.ValidationError{
			{InstanceLocation: "/topology", Message: "other"},
			{InstanceLocation: "", Causes: []*jsonschema.ValidationError{name}},
		},
	}

	assert.Same(t, name, causeAt(err, "/name"))
	assert.Same(t, err, causeAt(err, ""))
	assert.Nil(t, causeAt(err, "/missing"))
}

func TestParseAnnotations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "annotations.json")
	require.NoError(
		t,
		os.WriteFile(path, []byte(`{"type": "object", "properties": {"nodes": {"type": "array"}}}`), 0o600),
	)

	schema, schemaString := loadSchema("", path, "annotations schema")
	service := &Service{annotationsSchema: schema, annotationsSchemaString: schemaString}

	parsed, err := service.ParseAnnotations(`{"nodes": []}`)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"nodes": []any{}}, *parsed)

	_, err = service.ParseAnnotations(`{"nodes": [`)
	require.ErrorIs(t, err, utils.ErrInvalidTopology, "malformed JSON")

	_, err = service.ParseAnnotations(`{"nodes": "not a list"}`)
	assert.ErrorIs(t, err, utils.ErrInvalidTopology, "a schema violation")
}

// parseService validates against the clab schema of the repository.
func parseService(t *testing.T) *Service {
	t.Helper()

	schema, schemaString := loadSchema("", filepath.Join("..", "..", "..", "data", "clab.schema.json"), "clab schema")
	return &Service{clabSchema: schema, schemaString: schemaString}
}

func TestParse_DecodesAValidDefinition(t *testing.T) {
	var definition clabtypes.TopologyDefinition
	var definitionRaw any

	err := parseService(
		t,
	).Parse("name: lab\ntopology:\n  nodes:\n    a:\n      kind: linux\n", &definition, &definitionRaw)
	require.NoError(t, err)

	assert.Equal(t, "lab", definition.Name)
	require.Contains(t, definition.Topology.Nodes, "a")
	assert.Equal(t, "linux", definition.Topology.Nodes["a"].Kind)
	assert.Equal(t, "lab", definitionRaw.(map[string]any)["name"])
}

func TestParse_ErrorsNameFieldsInsteadOfTypes(t *testing.T) {
	for name, testCase := range map[string]struct {
		definition string
		expected   error
		message    string
	}{
		"invalid YAML": {
			definition: "name: lab\ntopology: [\n",
			expected:   utils.ErrInvalidTopology,
			message:    "yaml: ",
		},
		"a sequence instead of a mapping": {
			definition: "name: lab\ntopology:\n  nodes:\n    - not-a-map\n",
			expected:   utils.ErrInvalidTopology,
			message:    "topology.nodes: ",
		},
		"a list instead of a string": {
			definition: "name: lab\ntopology:\n  nodes:\n    a:\n      kind: linux\n      image: [alpine]\n",
			expected:   utils.ErrInvalidTopology,
			message:    "topology.nodes.a.image: ",
		},
		"an invalid name": {
			definition: "name: has spaces\ntopology:\n  nodes:\n    a:\n      kind: linux\n",
			expected:   utils.ErrInvalidTopologyName,
			message:    "name: ",
		},
	} {
		t.Run(name, func(t *testing.T) {
			var definition clabtypes.TopologyDefinition
			var definitionRaw any

			err := parseService(t).Parse(testCase.definition, &definition, &definitionRaw)
			require.ErrorIs(t, err, testCase.expected)
			assert.Contains(t, err.Error(), testCase.message)
			assert.NotContains(t, err.Error(), "unmarshal", "the Go types of the definition must not reach the client")
		})
	}
}

// A definition the schema accepts but the types don't can only come from a schema that is out of step with the
// types, the client gets the plain error then.
func TestParse_DefinitionsTheTypesRejectAreInvalid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema.json")
	require.NoError(t, os.WriteFile(path, []byte(`{}`), 0o600))
	schema, schemaString := loadSchema("", path, "clab schema")
	service := &Service{clabSchema: schema, schemaString: schemaString}

	var definition clabtypes.TopologyDefinition
	var definitionRaw any

	err := service.Parse("name: lab\ntopology:\n  nodes:\n    - not-a-map\n", &definition, &definitionRaw)
	require.Error(t, err)
	assert.Equal(t, utils.ErrInvalidTopology.Error(), err.Error())
}

package schema

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/santhosh-tekuri/jsonschema/v5"
	"gopkg.in/yaml.v3"

	"github.com/antimony-team/antimony-server/clabtypes"
	"github.com/antimony-team/antimony-server/config"
	"github.com/antimony-team/antimony-server/utils"
)

type (
	Service struct {
		schemaString            *string
		clabSchema              *jsonschema.Schema
		annotationsSchemaString *string
		annotationsSchema       *jsonschema.Schema
	}
)

func CreateService(config *config.AntimonyConfig) *Service {
	schema, schemaString := loadSchema(
		config.Containerlab.SchemaUrl,
		config.Containerlab.SchemaFallback,
		"clab schema",
	)
	annotationsSchema, annotationsSchemaString := loadSchema(
		config.Containerlab.AnnotationsSchemaUrl,
		config.Containerlab.AnnotationsSchemaFallback,
		"clab annotations schema",
	)

	return &Service{
		schemaString:            schemaString,
		clabSchema:              schema,
		annotationsSchemaString: annotationsSchemaString,
		annotationsSchema:       annotationsSchema,
	}
}

func (u *Service) Get() string {
	return *u.schemaString
}

func (u *Service) GetAnnotations() string {
	return *u.annotationsSchemaString
}

// Parse unmarshals a topology definition and validates it against the containerlab schema.
func (u *Service) Parse(data string, definition *clabtypes.TopologyDefinition, definitionRaw *any) error {
	var node yaml.Node

	if err := yaml.Unmarshal([]byte(data), &node); err != nil {
		return fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
	} else if err := node.Decode(definitionRaw); err != nil {
		return fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
	}

	// The schema is checked before the definition is decoded into its types, since the decoder's errors name Go
	// types instead of fields
	if err := u.clabSchema.Validate(*definitionRaw); err != nil {
		validationErr, ok := errors.AsType[*jsonschema.ValidationError](err)
		if !ok {
			return utils.ErrInvalidTopology
		}

		if nameErr := causeAt(validationErr, "/name"); nameErr != nil {
			return fmt.Errorf("%w: %s", utils.ErrInvalidTopologyName, describeValidationError(nameErr))
		}

		return fmt.Errorf("%w: %s", utils.ErrInvalidTopology, describeValidationError(validationErr))
	}

	if err := node.Decode(definition); err != nil {
		log.Warn("Failed to decode a topology definition that matches the schema", "error", err.Error())
		return utils.ErrInvalidTopology
	}

	return nil
}

// ParseAnnotations unmarshals a topology annotations file and validates it against the annotations' schema.
func (u *Service) ParseAnnotations(data string) (*any, error) {
	var obj any

	if err := json.Unmarshal([]byte(data), &obj); err != nil {
		return nil, fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
	}

	if err := u.annotationsSchema.Validate(obj); err != nil {
		return nil, fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
	}

	return &obj, nil
}

func loadSchema(url string, fallback string, name string) (*jsonschema.Schema, *string) {
	var schemaString string

	if url == "" {
		schemaString = readFallbackSchema(fallback, name)
	} else if resp, err := http.Get(url); err != nil || resp.StatusCode != http.StatusOK { //nolint:noctx // We don't need to provide context here
		if err == nil {
			// An error page, e.g. a 404 or a rate limit, isn't a schema
			_ = resp.Body.Close()
		}
		log.Warnf("Failed to download %s from remote resource. Falling back to local schema.", name)

		// Try to use local fallback schema instead
		schemaString = readFallbackSchema(fallback, name)
	} else {
		buf := new(strings.Builder)
		_, err := io.Copy(buf, resp.Body)
		_ = resp.Body.Close()

		if err != nil {
			log.Fatalf("Failed to parse remote %s. Exiting.", name)
			return nil, nil
		}

		schemaString = buf.String()
	}

	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("schema.json", strings.NewReader(schemaString)); err != nil {
		log.Fatalf("Failed to read %s. Exiting.", name)
		return nil, nil
	}

	jsonSchema, err := compiler.Compile("schema.json")
	if err != nil {
		log.Fatalf("Failed to compile %s. Exiting.", name)
		return nil, nil
	}

	return jsonSchema, &schemaString
}

func readFallbackSchema(fallback string, name string) string {
	var schema any

	schemaData, err := os.ReadFile(fallback)
	if err != nil {
		log.Fatalf("Failed to read fallback %s. Exiting.", name)
		return ""
	}

	if err := json.Unmarshal(schemaData, &schema); err != nil {
		log.Fatalf("Failed to parse fallback %s. Exiting.", name)
		return ""
	}

	return string(schemaData)
}

// causeAt returns the validation error or the first of its causes that failed at the given location, or nil.
func causeAt(err *jsonschema.ValidationError, location string) *jsonschema.ValidationError {
	if err.InstanceLocation == location {
		return err
	}

	for _, cause := range err.Causes {
		if found := causeAt(cause, location); found != nil {
			return found
		}
	}

	return nil
}

// describeValidationError says which field is wrong and why, without the validator's prefix and the schema URL,
// which the client has no use for. Of all causes, the one of the deepest field is the most specific. The first
// ones aren't necessarily, e.g. a node is null or a map, so a node with an invalid field fails as "expected null"
// before it fails at the field.
func describeValidationError(err *jsonschema.ValidationError) string {
	cause := deepestCause(err)

	if path := pointerToPath(cause.InstanceLocation); path != "" {
		return path + ": " + cause.Message
	}
	return cause.Message
}

// deepestCause returns the cause without causes of its own that failed at the deepest location, the first one of
// those if there are several.
func deepestCause(err *jsonschema.ValidationError) *jsonschema.ValidationError {
	if len(err.Causes) == 0 {
		return err
	}

	var deepest *jsonschema.ValidationError
	for _, cause := range err.Causes {
		leaf := deepestCause(cause)
		if deepest == nil || strings.Count(leaf.InstanceLocation, "/") > strings.Count(deepest.InstanceLocation, "/") {
			deepest = leaf
		}
	}

	return deepest
}

// pointerToPath turns a JSON pointer like /topology/links/0/endpoints into a path like topology.links[0].endpoints,
// the way the policy findings write it. The root becomes an empty path.
func pointerToPath(pointer string) string {
	var path strings.Builder

	for token := range strings.SplitSeq(strings.TrimPrefix(pointer, "/"), "/") {
		if token == "" {
			continue
		}

		// The escapes of JSON pointers, see RFC 6901
		token = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")

		if _, err := strconv.Atoi(token); err == nil {
			path.WriteString("[" + token + "]")
			continue
		}

		if path.Len() > 0 {
			path.WriteString(".")
		}
		path.WriteString(token)
	}

	return path.String()
}

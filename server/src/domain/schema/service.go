package schema

import (
	"antimonyBackend/clabtypes"
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/santhosh-tekuri/jsonschema/v5"
	"gopkg.in/yaml.v3"
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
	} else if err := node.Decode(definition); err != nil {
		return fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
	} else if err := node.Decode(definitionRaw); err != nil {
		return fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
	}

	if err := u.clabSchema.Validate(*definitionRaw); err != nil {
		log.Error(err, "Topology validation error")
		if validationErr, ok := errors.AsType[*jsonschema.ValidationError](err); ok && failsAt(validationErr, "/name") {
			return fmt.Errorf("%w: %s", utils.ErrInvalidTopologyName, err.Error())
		}

		return fmt.Errorf("%w: %s", utils.ErrInvalidTopology, err.Error())
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
	} else if resp, err := http.Get(url); err != nil { //nolint:noctx // We don't need to provide context here
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

// failsAt returns whether the validation error or one of its causes failed at the given location.
func failsAt(err *jsonschema.ValidationError, location string) bool {
	if err.InstanceLocation == location {
		return true
	}

	for _, cause := range err.Causes {
		if failsAt(cause, location) {
			return true
		}
	}

	return false
}

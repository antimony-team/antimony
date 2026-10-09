package schema

import (
	"antimonyBackend/config"
	"antimonyBackend/utils"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/santhosh-tekuri/jsonschema/v5"
	"gopkg.in/yaml.v3"
)

type Service struct {
	schemaString      *string
	clabSchema        *jsonschema.Schema
	annotationsSchema *jsonschema.Schema
}

func CreateService(config *config.AntimonyConfig) *Service {
	schema, schemaString := loadSchema(
		config.Containerlab.SchemaUrl,
		config.Containerlab.SchemaFallback,
		"clab schema",
	)
	annotationsSchema, _ := loadSchema(
		config.Containerlab.AnnotationsSchemaUrl,
		config.Containerlab.AnnotationsSchemaFallback,
		"clab annotations schema",
	)

	return &Service{
		schemaString:      schemaString,
		clabSchema:        schema,
		annotationsSchema: annotationsSchema,
	}
}

func (u *Service) Get() string {
	return *u.schemaString
}

// Parse unmarshals a topology definition and validates it against the containerlab schema.
func (u *Service) Parse(data string) (*any, error) {
	var obj any

	if err := yaml.Unmarshal([]byte(data), &obj); err != nil {
		return nil, utils.ErrInvalidTopology
	}

	if err := u.clabSchema.Validate(obj); err != nil {
		log.Warn("Topology definition failed schema validation", "err", err.Error())

		return nil, utils.ErrInvalidTopology
	}

	return &obj, nil
}

// ParseAnnotations unmarshals a topology annotations file and validates it against the annotations schema.
func (u *Service) ParseAnnotations(data string) (*any, error) {
	var obj any

	if err := json.Unmarshal([]byte(data), &obj); err != nil {
		return nil, utils.ErrInvalidTopology
	}

	if err := u.annotationsSchema.Validate(obj); err != nil {
		log.Warn("Topology annotations failed schema validation", "err", err.Error())

		return nil, utils.ErrInvalidTopology
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

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

type (
	Service interface {
		Get() string
		Parse(data string) (*any, error)
	}

	schemaService struct {
		schemaString *string
		clabSchema   *jsonschema.Schema
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	schema, schemaString := loadSchema(config)

	return &schemaService{
		schemaString: schemaString,
		clabSchema:   schema,
	}
}

func (u *schemaService) Get() string {
	return *u.schemaString
}

func (u *schemaService) Parse(data string) (*any, error) {
	var obj any

	if err := yaml.Unmarshal([]byte(data), &obj); err != nil {
		return nil, utils.ErrInvalidTopology
	}

	return &obj, u.clabSchema.Validate(obj)
}

func loadSchema(config *config.AntimonyConfig) (*jsonschema.Schema, *string) {
	var schema any
	var schemaString string

	//nolint:noctx // We don't need to provide context here
	resp, err := http.Get(config.Containerlab.SchemaUrl)

	if err != nil {
		log.Warn("Failed to download clab schema from remote resource. Falling back to local schema.")

		// Try to use local fallback schema instead
		if schemaData, err := os.ReadFile(config.Containerlab.SchemaFallback); err != nil {
			log.Fatal("Failed to read fallback clab schema. Exiting.")
			return nil, nil
		} else {
			if err := json.Unmarshal(schemaData, &schema); err != nil {
				log.Fatal("Failed to parse fallback clab schema. Exiting.")
				return nil, nil
			}

			schemaString = string(schemaData)
		}
	} else {
		buf := new(strings.Builder)
		_, err := io.Copy(buf, resp.Body)
		_ = resp.Body.Close()

		if err != nil {
			log.Fatal("Failed to parse remote clab schema. Exiting.")
			return nil, nil
		}

		schemaString = buf.String()
	}

	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("clab-schema.json", strings.NewReader(schemaString)); err != nil {
		log.Fatal("Failed to read clab schema. Exiting.")
		return nil, nil
	}

	jsonSchema, err := compiler.Compile("clab-schema.json")
	if err != nil {
		log.Fatal("Failed to compile remote clab schema. Exiting.")
		return nil, nil
	}

	return jsonSchema, &schemaString
}

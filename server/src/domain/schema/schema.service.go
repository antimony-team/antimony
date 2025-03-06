package schema

import (
	"antimonyBackend/src/config"
	"encoding/json"
	"github.com/charmbracelet/log"
	"net/http"
	"os"
)

type (
	Service interface {
		Get() any
	}

	schemaService struct {
		clabSchema any
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	schema := loadSchema(config)

	return &schemaService{
		clabSchema: schema,
	}
}

func (u *schemaService) Get() any {
	return u.clabSchema
}

func loadSchema(config *config.AntimonyConfig) any {
	var schema any

	log.Info("Fetching Containerlab schema from remote source.")

	if resp, err := http.Get(config.Containerlab.SchemaUrl); err != nil {
		log.Error("Failed to download clab schema. Falling back to local schema.")

		// Try to use local fallback schema instead
		if schemaData, err := os.ReadFile(config.Containerlab.SchemaFallback); err != nil {
			log.Fatal("Failed to read fallback clab schema. Exiting.")
		} else {
			if err := json.Unmarshal(schemaData, &schema); err != nil {
				log.Fatal("Failed to parse fallback clab schema. Exiting.")
			}
		}
	} else {
		if err := json.NewDecoder(resp.Body).Decode(&schema); err != nil {
			log.Fatal("Failed to parse remote clab schema. Exiting.")
		}
	}

	log.Info("Successfully fetched Containerlab schema.")

	return schema
}

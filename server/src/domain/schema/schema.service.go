package schema

import (
	"antimonyBackend/config"
	"encoding/json"
	"github.com/charmbracelet/log"
	"io"
	"net/http"
	"os"
	"strings"
)

type (
	Service interface {
		Get() string
	}

	schemaService struct {
		clabSchema string
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	schema := loadSchema(config)

	return &schemaService{
		clabSchema: schema,
	}
}

func (u *schemaService) Get() string {
	return u.clabSchema
}

func loadSchema(config *config.AntimonyConfig) string {
	var schema any

	if resp, err := http.Get(config.Containerlab.SchemaUrl); err != nil {
		log.Warn("Failed to download clab schema from remote resource. Falling back to local schema.")

		// Try to use local fallback schema instead
		if schemaData, err := os.ReadFile(config.Containerlab.SchemaFallback); err != nil {
			log.Fatal("Failed to read fallback clab schema. Exiting.")
		} else {
			if err := json.Unmarshal(schemaData, &schema); err != nil {
				log.Fatal("Failed to parse fallback clab schema. Exiting.")
			}

			return string(schemaData)
		}
	} else {
		buf := new(strings.Builder)
		if _, err := io.Copy(buf, resp.Body); err != nil {
			log.Fatal("Failed to parse remote clab schema. Exiting.")
		}

		return buf.String()
		//if err := json.NewDecoder(resp.Body).Decode(&schema); err != nil {
		//	log.Fatal("Failed to parse remote clab schema. Exiting.")
		//} else {
		//	buf := new(strings.Builder)
		//	if _, err := io.Copy(buf, resp.Body); err != nil {
		//		log.Fatal("Failed to parse remote clab schema. Exiting.")
		//	}
		//
		//	return buf.String()
		//}
	}

	return ""
}

package schema

import (
	"antimonyBackend/config"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/charmbracelet/log"
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

	//nolint:noctx // We don't need to provide context here
	resp, err := http.Get(config.Containerlab.SchemaUrl)

	if err != nil {
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
		_, err := io.Copy(buf, resp.Body)
		_ = resp.Body.Close()

		if err != nil {
			log.Fatal("Failed to parse remote clab schema. Exiting.")
		}

		return buf.String()
	}

	return ""
}

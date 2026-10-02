package utils

import (
	"github.com/google/uuid"
)

func GenerateUuid() string {
	uuid1, err := uuid.NewRandom()
	if err != nil {
		panic("Failed to generate UUID")
	}

	return uuid1.String()
}

// IsUuid reports whether str is a UUID in the form GenerateUuid produces.
func IsUuid(str string) bool {
	parsed, err := uuid.Parse(str)
	return err == nil && parsed.String() == str
}

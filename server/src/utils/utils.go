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

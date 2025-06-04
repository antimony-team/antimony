package utils

import (
	"github.com/google/uuid"
	"os"
)

func GenerateUuid() string {
	uuid1, err := uuid.NewUUID()
	if err != nil {
		panic("Failed to generate UUID")
	}

	return uuid1.String()
}

func IsDirectoryWritable(path string) bool {
	info, err := os.Stat(path)

	// TODO: Proper access check implementation
	return err == nil && info.IsDir() && info.Mode().Perm()&(1<<(uint(7))) != 0
}

func StringPtr(s string) *string {
	return &s
}

func NounCounter(noun string, count int) string {
	if count == 1 {
		return noun
	}
	return noun + "s"
}

func GetItemsFromList[T any](list []T, limit int, offset int) []T {
	if offset >= len(list) {
		return make([]T, 0)
	}

	end := offset + limit
	if end > len(list) {
		end = len(list)
	}

	return list[offset:end]
}

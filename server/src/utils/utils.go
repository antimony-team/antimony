package utils

import (
	"errors"
	"fmt"
	"regexp"
	"slices"

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

// ParseEnum returns s as T if it's one of the allowed values.
func ParseEnum[T ~string](what string, s string, allowed ...T) (T, error) {
	if slices.Contains(allowed, T(s)) {
		return T(s), nil
	}
	return "", fmt.Errorf("unknown %s %q (expected one of %v)", what, s, allowed)
}

// namePattern allows letters, digits, spaces and . _ -, starting with a letter or digit. That keeps a name usable in
// the SSH address <collection>/<lab>/<node> and in shell commands.
var namePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._-]*$`)

func IsValidName(name string) error {
	if len(name) > 64 {
		return errors.New("the name can't be longer than 64 characters")
	}

	if !namePattern.MatchString(name) {
		return fmt.Errorf("the name must match %s", namePattern)
	}

	return nil
}

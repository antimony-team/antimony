package utils

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsValidName_AcceptsLettersDigitsSpacesAndDotsUnderscoresHyphens(t *testing.T) {
	for _, name := range []string{"a", "1", "Core Lab 1.0_a-b", "lab-", strings.Repeat("a", 64)} {
		t.Run(name, func(t *testing.T) {
			assert.NoError(t, IsValidName(name))
		})
	}
}

func TestIsValidName_RejectsEverythingElse(t *testing.T) {
	cases := map[string]string{
		"empty":              "",
		"leading space":      " lab",
		"leading dot":        ".lab",
		"leading underscore": "_lab",
		"leading hyphen":     "-lab",
		"slash":              "core/edge",
		"semicolon":          "a;b",
		"quote":              "it's",
		"non-ascii":          "läb",
		"tab":                "a\tb",
		"65 characters":      strings.Repeat("a", 65),
	}

	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Error(t, IsValidName(value))
		})
	}
}

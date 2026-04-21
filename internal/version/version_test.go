package version_test

import (
	"strings"
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/version"
)

func TestCurrentIsNotEmpty(t *testing.T) {
	if version.Current == "" {
		t.Fatal("version.Current must not be empty")
	}
}

func TestCurrentStartsWithDigit(t *testing.T) {
	if !strings.ContainsAny(version.Current[:1], "0123456789v") {
		t.Fatalf("version.Current %q should start with a digit or 'v'", version.Current)
	}
}

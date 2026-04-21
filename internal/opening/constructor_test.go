package opening_test

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/opening"
)

func TestNewClassifier_Succeeds(t *testing.T) {
	c, err := opening.NewClassifier()
	if err != nil {
		t.Fatalf("NewClassifier() returned unexpected error: %v", err)
	}
	if c == nil {
		t.Fatal("NewClassifier() returned nil classifier")
	}
	// Verify ECO data was actually loaded by classifying a known position.
	// Ruy Lopez starting position — ECO C60.
	entry := c.ClassifyGame("1. e4 e5 2. Nf3 Nc6 3. Bb5")
	if entry == nil {
		t.Fatal("ClassifyGame returned nil for known Ruy Lopez position; ECO data may not have loaded")
	}
}

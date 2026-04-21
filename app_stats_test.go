package main

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/opening"
)

func TestBuildOpeningPGN_SingleEntry(t *testing.T) {
	entries := []*opening.Entry{
		{ECO: "C42", Name: "Test", Moves: "1. e4 e5 2. Nf3 Nf6"},
	}
	got := buildOpeningPGN(entries)
	if got != "1. e4 e5 2. Nf3 Nf6" {
		t.Errorf("single entry: got %q", got)
	}
}

func TestBuildOpeningPGN_SameBranch(t *testing.T) {
	// Petrov's Defense: 5 entries on the same branch.
	// The deepest should become the mainline, shorter ones are prefixes (no variations).
	entries := []*opening.Entry{
		{ECO: "C42", Name: "Petrov's Defense", Moves: "1. e4 e5 2. Nf3 Nf6"},
		{ECO: "C42", Name: "Petrov's Defense", Moves: "1. e4 e5 2. Nf3 Nf6 3. Nxe5"},
		{ECO: "C42", Name: "Petrov's Defense", Moves: "1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6"},
		{ECO: "C42", Name: "Petrov's Defense", Moves: "1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3"},
		{ECO: "C42", Name: "Petrov's Defense", Moves: "1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4"},
	}
	got := buildOpeningPGN(entries)
	// All are prefixes of the longest — should produce just the longest line.
	want := "1. e4 1... e5 2. Nf3 2... Nf6 3. Nxe5 3... d6 4. Nf3 4... Nxe4"
	if got != want {
		t.Errorf("same-branch:\n  got:  %q\n  want: %q", got, want)
	}
}

func TestBuildOpeningPGN_DivergentLines(t *testing.T) {
	// English Defense: two entries on different branches.
	// Shallowest (1. d4 b6) becomes mainline so targetFen lands on it.
	entries := []*opening.Entry{
		{ECO: "A40", Name: "English Defense", Moves: "1. d4 b6"},
		{ECO: "A40", Name: "English Defense", Moves: "1. d4 e6 2. c4 b6"},
	}
	got := buildOpeningPGN(entries)
	// Variation appears after mainline move at the divergence point.
	want := "1. d4 1... b6 (1... e6 2. c4 2... b6)"
	if got != want {
		t.Errorf("divergent:\n  got:  %q\n  want: %q", got, want)
	}
}

func TestBuildOpeningPGN_DivergentSameLength(t *testing.T) {
	// Two entries diverging late, same length. First entry (shallowest in
	// insertion order) becomes mainline.
	entries := []*opening.Entry{
		{ECO: "C33", Name: "Test Gambit", Moves: "1. e4 e5 2. f4 exf4 3. Bb5"},
		{ECO: "C33", Name: "Test Gambit", Moves: "1. e4 e5 2. f4 exf4 3. Bd3"},
	}
	got := buildOpeningPGN(entries)
	// Diverge at ply 4 (after 2... exf4). Variation inserted after mainline
	// move at divergence point.
	want := "1. e4 1... e5 2. f4 2... exf4 3. Bb5 (3. Bd3)"
	if got != want {
		t.Errorf("divergent same length:\n  got:  %q\n  want: %q", got, want)
	}
}

func TestLookupAllByECOAndName(t *testing.T) {
	c, err := opening.NewClassifier()
	if err != nil {
		t.Fatalf("NewClassifier: %v", err)
	}
	// English Defense has two entries with different positions.
	entries := c.LookupAllByECOAndName("A40", "English Defense")
	if len(entries) < 2 {
		t.Fatalf("expected at least 2 entries for A40 English Defense, got %d", len(entries))
	}
	// First should be shallowest (fewest moves).
	if entries[0].Moves != "1. d4 b6" {
		t.Errorf("expected shallowest first, got %q", entries[0].Moves)
	}
	for i, e := range entries {
		t.Logf("entry %d: %q (EPD: %s)", i, e.Moves, e.EPD)
	}
}

func TestGetOpeningInfo_EnglishDefense(t *testing.T) {
	c, err := opening.NewClassifier()
	if err != nil {
		t.Fatalf("NewClassifier: %v", err)
	}
	app := &App{classifier: c}
	info, err := app.GetOpeningInfo("A40", "English Defense")
	if err != nil {
		t.Fatalf("GetOpeningInfo: %v", err)
	}
	t.Logf("PGN: %q", info.PGN)
	t.Logf("FEN: %q", info.FEN)
	if info.PGN == "1. d4 b6" {
		t.Errorf("PGN should include variation but got only mainline: %q", info.PGN)
	}
}

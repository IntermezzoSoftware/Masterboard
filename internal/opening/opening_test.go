package opening

import "testing"

// testClassifier returns a Classifier for use in tests, failing the test if
// initialisation fails. The embedded ECO data is always present in a correct
// build, so this should never fail in practice.
func testClassifier(t *testing.T) *Classifier {
	t.Helper()
	c, err := NewClassifier()
	if err != nil {
		t.Fatalf("NewClassifier: %v", err)
	}
	return c
}

func TestClassifyKnownFEN(t *testing.T) {
	c := testClassifier(t)
	// FEN for Ruy Lopez: 1.e4 e5 2.Nf3 Nc6 3.Bb5
	fen := "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3"
	entry := c.Classify(fen)
	if entry == nil {
		t.Fatal("expected ECO entry for Ruy Lopez position, got nil")
	}
	if entry.ECO != "C60" {
		t.Errorf("expected ECO C60 (Ruy Lopez), got %q", entry.ECO)
	}
	if entry.Name != "Ruy Lopez" {
		t.Errorf("expected Name 'Ruy Lopez', got %q", entry.Name)
	}
}

func TestClassifyStartingPosition(t *testing.T) {
	c := testClassifier(t)
	// The starting position is not in the ECO book.
	entry := c.Classify("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
	if entry != nil {
		t.Errorf("expected nil for starting position, got %+v", entry)
	}
}

func TestClassifyEPDWithoutCounters(t *testing.T) {
	c := testClassifier(t)
	// Classify should accept a 4-field EPD (no halfmove/fullmove) directly.
	epd := "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -"
	entry := c.Classify(epd)
	if entry == nil {
		t.Fatal("expected ECO entry from EPD, got nil")
	}
	if entry.ECO != "C60" {
		t.Errorf("expected C60, got %q", entry.ECO)
	}
}

func TestClassifyGamePGN(t *testing.T) {
	c := testClassifier(t)
	// A game whose mainline passes through the Ruy Lopez position.
	pgn := `[Event "Test"]
[White "A"]
[Black "B"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *`

	entry := c.ClassifyGame(pgn)
	if entry == nil {
		t.Fatal("expected ECO entry from PGN, got nil")
	}
	// Deepest match should be a Ruy Lopez variation (C60 or deeper).
	if len(entry.ECO) < 3 || entry.ECO[:1] != "C" {
		t.Errorf("expected a C-series ECO for Ruy Lopez game, got %q", entry.ECO)
	}
}

func TestTransposition(t *testing.T) {
	c := testClassifier(t)
	// King's Indian Attack can be reached via different move orders.
	// Both should produce the same ECO for positions present in the book.
	// Classify is purely FEN-based — different move orders to the same position
	// must produce the same ECO.

	// Sicilian Defense position after 1.e4 c5 (B20)
	// Reached via normal order:
	normalOrder := c.ClassifyGame("[Event \"\"] 1. e4 c5 *")
	// Reached via... well, 1.e4 c5 is the only way, but we verify the FEN lookup
	// matches the EPD in the table.
	fen := "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
	directLookup := c.Classify(fen)

	if normalOrder == nil || directLookup == nil {
		t.Fatal("expected ECO entries from both approaches, at least one is nil")
	}
	if normalOrder.ECO != directLookup.ECO {
		t.Errorf("move-path classification %q != FEN classification %q",
			normalOrder.ECO, directLookup.ECO)
	}
}

func TestClassifyGameEmptyPGN(t *testing.T) {
	c := testClassifier(t)
	if c.ClassifyGame("") != nil {
		t.Error("expected nil for empty PGN")
	}
}

func TestLookupByECOAndName(t *testing.T) {
	c := testClassifier(t)
	e := c.LookupByECOAndName("A00", "Amar Opening")
	if e == nil {
		t.Fatal("expected non-nil entry for A00 Amar Opening")
	}
	if e.Moves == "" {
		t.Error("expected non-empty Moves")
	}
	if e.EPD == "" {
		t.Error("expected non-empty EPD")
	}
	if e.ECO != "A00" {
		t.Errorf("expected ECO A00, got %q", e.ECO)
	}
}

func TestLookupByECOAndNameMissing(t *testing.T) {
	c := testClassifier(t)
	if c.LookupByECOAndName("ZZZ", "Nonexistent Opening") != nil {
		t.Error("expected nil for unknown ECO+name")
	}
}


// The Amar Opening family in the TSV provides a clear multi-depth chain:
//
//	Amar Opening          (1 move:  1. Nh3)
//	Amar Opening: Paris Gambit  (5 moves: …3. f4)
//	Amar Gambit           (8 moves: …4. Bxh3 exf4)
//	Amar Opening: Gent Gambit   (12 moves: …6. hxg3)
func TestDescendantsContainsDeepEntry(t *testing.T) {
	c := testClassifier(t)
	descendants := c.Descendants("A00", "Amar Opening")
	for _, e := range descendants {
		if e.ECO == "A00" && e.Name == "Amar Gambit" {
			return
		}
	}
	t.Error("expected Descendants(A00, Amar Opening) to contain Amar Gambit")
}

func TestAncestorsContainsRoot(t *testing.T) {
	c := testClassifier(t)
	ancestors := c.Ancestors("A00", "Amar Gambit")
	for _, e := range ancestors {
		if e.ECO == "A00" && e.Name == "Amar Opening" {
			return
		}
	}
	t.Errorf("expected Ancestors(A00, Amar Gambit) to contain Amar Opening; got %v", ancestors)
}

func TestParentOfParisDerivedFromAmarOpening(t *testing.T) {
	c := testClassifier(t)
	// Amar Opening: Paris Gambit (5 moves) — no TSV entry exists between 1 and 5
	// moves in this line, so its direct parent must be Amar Opening.
	p := c.Parent("A00", "Amar Opening: Paris Gambit")
	if p == nil {
		t.Fatal("expected non-nil parent for Amar Opening: Paris Gambit")
	}
	if p.Name != "Amar Opening" {
		t.Errorf("expected parent Amar Opening, got %q", p.Name)
	}
}

func TestChildrenIncludesParisDerivedFromAmarOpening(t *testing.T) {
	c := testClassifier(t)
	children := c.Children("A00", "Amar Opening")
	for _, ch := range children {
		if ch.Name == "Amar Opening: Paris Gambit" {
			return
		}
	}
	t.Errorf("expected Children(A00, Amar Opening) to include Paris Gambit; got %v", children)
}

func TestRootEntryHasNilParent(t *testing.T) {
	c := testClassifier(t)
	// Amar Opening has a single-move sequence and nothing precedes it in the book.
	if p := c.Parent("A00", "Amar Opening"); p != nil {
		t.Errorf("expected nil parent for root entry, got %+v", p)
	}
}

func TestUnknownEntryReturnsNilParent(t *testing.T) {
	c := testClassifier(t)
	if c.Parent("ZZZ", "Nonexistent") != nil {
		t.Error("expected nil parent for unknown entry")
	}
}

func TestDescendantsOfUnknownEntryIsEmpty(t *testing.T) {
	c := testClassifier(t)
	if d := c.Descendants("ZZZ", "Nonexistent"); len(d) != 0 {
		t.Errorf("expected empty descendants for unknown entry, got %d", len(d))
	}
}

func TestLookupByECO(t *testing.T) {
	c := testClassifier(t)
	// C60 has many Ruy Lopez sub-variations; the base should have the fewest moves.
	e := c.LookupByECO("C60")
	if e == nil {
		t.Fatal("expected non-nil entry for ECO C60")
	}
	if e.ECO != "C60" {
		t.Errorf("expected ECO C60, got %q", e.ECO)
	}
	if e.Moves == "" {
		t.Error("expected non-empty Moves")
	}
	// C60 base is 1.e4 e5 2.Nf3 Nc6 3.Bb5 — verify it's shallower than any sub-variation.
	all := []string{"Ruy Lopez", "Ruy Lopez: Alapin Defense", "Ruy Lopez: Bird Variation"}
	for _, name := range all {
		sub := c.LookupByECOAndName("C60", name)
		if sub != nil && len(sub.Moves) < len(e.Moves) {
			t.Errorf("LookupByECO returned longer moves than sub-variation %q: %d vs %d", name, len(e.Moves), len(sub.Moves))
		}
	}
}

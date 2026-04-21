package pgn

import (
	"strings"
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

const simpleLinePGN = `[Event "Simple"]
[Site "https://lichess.org/study/st1/ch1"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *
`

const variationPGN = `[Event "Variation"]
[Site "https://lichess.org/study/st1/ch2"]
[Result "*"]

1. e4 (1. d4 d5) 1... e5 *
`

const consecutiveVariationsPGN = `[Event "Consecutive Variations"]
[Site "https://lichess.org/study/st1/ch5"]
[Result "*"]

1. e4 e5 (1... c5) (1... e6) *
`

const annotatedPGN = `[Event "Annotated"]
[Site "https://lichess.org/study/st1/ch3"]
[Result "*"]

1. e4 $1 { Best by test [%cal Ge2e4] } e5 *
`

const customFENPGN = `[Event "Custom FEN"]
[Site "https://lichess.org/study/st1/ch4"]
[FEN "8/8/8/8/8/8/4K3/4k3 w - - 0 1"]
[Result "*"]

1. Ke3 *
`

func TestWalkSimpleLine(t *testing.T) {
	moves, err := ImportChapterAsRepertoireMoves(simpleLinePGN, "rep1")
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 4 {
		t.Fatalf("want 4 moves, got %d", len(moves))
	}
	if moves[0].MoveSAN != "e4" {
		t.Errorf("first move: want e4, got %s", moves[0].MoveSAN)
	}
	if moves[0].ParentID != nil {
		t.Error("first move should have nil ParentID")
	}
	if moves[1].ParentID == nil || *moves[1].ParentID != moves[0].ID {
		t.Error("second move should be child of first")
	}
	for i, m := range moves {
		if m.MoveOrder != 0 {
			t.Errorf("move %d (%s): want MoveOrder=0, got %d", i, m.MoveSAN, m.MoveOrder)
		}
	}
}

func TestWalkVariation(t *testing.T) {
	// 1. e4 (1. d4 d5) 1... e5
	// e4(order=0), d4(order=1, sibling of e4), d5(child of d4), e5(child of e4)
	moves, err := ImportChapterAsRepertoireMoves(variationPGN, "rep1")
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 4 {
		t.Fatalf("want 4 moves, got %d: %v", len(moves), sanList(moves))
	}

	e4 := moves[0]
	d4 := moves[1]
	d5 := moves[2]
	e5 := moves[3]

	if e4.MoveSAN != "e4" || e4.MoveOrder != 0 {
		t.Errorf("want e4 order=0, got %s order=%d", e4.MoveSAN, e4.MoveOrder)
	}
	if d4.MoveSAN != "d4" || d4.MoveOrder != 1 {
		t.Errorf("want d4 order=1, got %s order=%d", d4.MoveSAN, d4.MoveOrder)
	}
	if d4.ParentID != nil {
		t.Error("d4 should have nil ParentID (sibling of e4 at root)")
	}
	if d5.ParentID == nil || *d5.ParentID != d4.ID {
		t.Error("d5 should be child of d4")
	}
	if e5.ParentID == nil || *e5.ParentID != e4.ID {
		t.Error("e5 should be child of e4")
	}
}

func TestWalkConsecutiveVariations(t *testing.T) {
	// 1. e4 e5 (1... c5) (1... e6)
	// e4, e5(order=0), c5(order=1, sibling of e5), e6(order=2, sibling of e5 and c5)
	moves, err := ImportChapterAsRepertoireMoves(consecutiveVariationsPGN, "rep1")
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 4 {
		t.Fatalf("want 4 moves (e4,e5,c5,e6), got %d: %v", len(moves), sanList(moves))
	}

	e4 := moves[0]
	e5 := moves[1]
	c5 := moves[2]
	e6 := moves[3]

	// e5, c5, and e6 must all share the same parent (e4's ID)
	if e5.ParentID == nil || *e5.ParentID != e4.ID {
		t.Error("e5 should be child of e4")
	}
	if c5.ParentID == nil || *c5.ParentID != e4.ID {
		t.Errorf("move c5 should be child of e4, got parentID=%v", c5.ParentID)
	}
	if e6.ParentID == nil || *e6.ParentID != e4.ID {
		t.Errorf("e6 should be child of e4, got parentID=%v", e6.ParentID)
	}

	// Orders: e5=0, c5=1, e6=2
	if e5.MoveOrder != 0 {
		t.Errorf("e5 MoveOrder: want 0, got %d", e5.MoveOrder)
	}
	if c5.MoveOrder != 1 {
		t.Errorf("c5 MoveOrder: want 1, got %d", c5.MoveOrder)
	}
	if e6.MoveOrder != 2 {
		t.Errorf("e6 MoveOrder: want 2, got %d", e6.MoveOrder)
	}
}

func TestWalkAnnotations(t *testing.T) {
	moves, err := ImportChapterAsRepertoireMoves(annotatedPGN, "rep1")
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) < 1 {
		t.Fatal("expected at least 1 move")
	}
	e4 := moves[0]
	if e4.NAG == nil || *e4.NAG != 1 {
		t.Errorf("e4 NAG: want 1, got %v", e4.NAG)
	}
	if e4.Comment != "Best by test" {
		t.Errorf("e4 comment: want %q, got %q", "Best by test", e4.Comment)
	}
	if e4.Shapes == "" {
		t.Error("e4 shapes should be non-empty (has cal annotation Ge2e4)")
	}
	if !strings.Contains(e4.Shapes, "e2") || !strings.Contains(e4.Shapes, "e4") || !strings.Contains(e4.Shapes, "green") {
		t.Errorf("e4 shapes unexpected: %s", e4.Shapes)
	}
}

func TestWalkCustomFEN(t *testing.T) {
	moves, err := ImportChapterAsRepertoireMoves(customFENPGN, "rep1")
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 1 {
		t.Fatalf("want 1 move, got %d", len(moves))
	}
	if moves[0].MoveSAN != "Ke3" {
		t.Errorf("want Ke3, got %s", moves[0].MoveSAN)
	}
}

func TestWalkRepertoireID(t *testing.T) {
	moves, err := ImportChapterAsRepertoireMoves(simpleLinePGN, "my-rep-id")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range moves {
		if m.RepertoireID != "my-rep-id" {
			t.Errorf("RepertoireID: want %q, got %q", "my-rep-id", m.RepertoireID)
		}
	}
}

func sanList(moves []repertoire.RepertoireMove) []string {
	out := make([]string, len(moves))
	for i, m := range moves {
		out[i] = m.MoveSAN
	}
	return out
}

const realStudyChapterPGN = `[Event "1. e4 — Main Lines"]
[Site "https://lichess.org/study/teststudy/chapter1"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[Orientation "white"]
[Result "*"]

1. e4 { The most popular first move. [%cal Ge2e4] } e5 (1... c5 { The Sicilian. } 2. Nf3 $5 { Active. }) (1... e6 { French Defence. }) 2. Nf3 $1 { Development. } Nc6 *
`

func TestWalkRealisticStudyChapter(t *testing.T) {
	moves, err := ImportChapterAsRepertoireMoves(realStudyChapterPGN, "rep1")
	if err != nil {
		t.Fatal(err)
	}
	// Expected: e4, e5, c5, Nf3(sicilian), e6, Nf3(main), Nc6 = 7 moves
	if len(moves) != 7 {
		t.Fatalf("want 7 moves, got %d: %v", len(moves), sanList(moves))
	}
	e4 := moves[0]
	if e4.MoveSAN != "e4" {
		t.Errorf("first move: want e4, got %s", e4.MoveSAN)
	}
	if e4.Comment != "The most popular first move." {
		t.Errorf("e4 comment: %q", e4.Comment)
	}
	if e4.Shapes == "" {
		t.Error("e4 should have shapes")
	}
	// Find main-line Nf3 (child of e5, has NAG=1)
	var mainNf3 *repertoire.RepertoireMove
	for i := range moves {
		if moves[i].MoveSAN == "Nf3" && moves[i].NAG != nil && *moves[i].NAG == 1 {
			mainNf3 = &moves[i]
		}
	}
	if mainNf3 == nil {
		t.Error("did not find main-line Nf3 with NAG=1")
	}
}

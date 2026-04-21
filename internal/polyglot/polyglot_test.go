package polyglot_test

import (
	"bytes"
	"testing"

	chess "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/polyglot"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

func strPtr(s string) *string { return &s }

func TestWriteReadRoundTrip(t *testing.T) {
	const key1 uint64 = 0x463b96181691fc9c
	const move1 uint16 = 0x1e4c
	const key2 uint64 = 0x823c9b50fd114196
	const move2 uint16 = 0x0f30

	entries := []chess.PolyglotEntry{
		{Key: key1, Move: move1, Weight: 100, Learn: 0},
		{Key: key2, Move: move2, Weight: 50, Learn: 0},
	}

	var buf bytes.Buffer
	if err := polyglot.WriteBook(&buf, entries); err != nil {
		t.Fatalf("WriteBook error: %v", err)
	}

	if buf.Len() != 32 {
		t.Fatalf("expected 32 bytes, got %d", buf.Len())
	}

	book, err := chess.LoadFromReader(&buf)
	if err != nil {
		t.Fatalf("LoadFromReader error: %v", err)
	}

	found := book.FindMoves(key1)
	if len(found) == 0 {
		t.Fatal("FindMoves returned no entries for key1")
	}
	if found[0].Move != move1 {
		t.Errorf("expected move %#x, got %#x", move1, found[0].Move)
	}
	if found[0].Weight != 100 {
		t.Errorf("expected weight 100, got %d", found[0].Weight)
	}
}

func TestCompileAndTraverseSmallRepertoire(t *testing.T) {
	const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	const afterE5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"

	m1ID := "move-1"
	moves := []repertoire.RepertoireMove{
		{
			ID:           m1ID,
			RepertoireID: "rep-1",
			ParentID:     nil,
			FromFEN:      start,
			ToFEN:        afterE4,
			MoveSAN:      "e4",
			MoveUCI:      "e2e4",
			MoveOrder:    0,
		},
		{
			ID:           "move-2",
			RepertoireID: "rep-1",
			ParentID:     strPtr(m1ID),
			FromFEN:      afterE4,
			ToFEN:        afterE5,
			MoveSAN:      "e5",
			MoveUCI:      "e7e5",
			MoveOrder:    0,
		},
	}

	entries, err := polyglot.CompileRepertoire(moves, nil)
	if err != nil {
		t.Fatalf("CompileRepertoire error: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	var buf bytes.Buffer
	if err := polyglot.WriteBook(&buf, entries); err != nil {
		t.Fatalf("WriteBook error: %v", err)
	}

	book, err := chess.LoadFromReader(&buf)
	if err != nil {
		t.Fatalf("LoadFromReader error: %v", err)
	}

	extracted, err := polyglot.TraverseBook(book, "white", 50)
	if err != nil {
		t.Fatalf("TraverseBook error: %v", err)
	}
	if len(extracted) != 2 {
		t.Fatalf("expected 2 extracted moves, got %d", len(extracted))
	}
	if extracted[0].MoveUCI != "e2e4" {
		t.Errorf("expected first MoveUCI 'e2e4', got %q", extracted[0].MoveUCI)
	}
}

// TestTraverseFollowsAllOpponentMoves verifies that all opponent moves in the book
// are followed during traversal — a repertoire import should recover every prepared
// line, not just the highest-weight opponent response.
func TestOpponentFilteringKeepsTopWeightedMove(t *testing.T) {
	const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	const afterE5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"
	const afterC5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2"

	m1ID := "move-1"
	// Two black responses to e4: e5 (MoveOrder 0, higher weight) and c5 (MoveOrder 1, lower weight).
	moves := []repertoire.RepertoireMove{
		{
			ID:           m1ID,
			RepertoireID: "rep-1",
			ParentID:     nil,
			FromFEN:      start,
			ToFEN:        afterE4,
			MoveSAN:      "e4",
			MoveUCI:      "e2e4",
			MoveOrder:    0,
		},
		{
			ID:           "move-2",
			RepertoireID: "rep-1",
			ParentID:     strPtr(m1ID),
			FromFEN:      afterE4,
			ToFEN:        afterE5,
			MoveSAN:      "e5",
			MoveUCI:      "e7e5",
			MoveOrder:    0,
		},
		{
			ID:           "move-3",
			RepertoireID: "rep-1",
			ParentID:     strPtr(m1ID),
			FromFEN:      afterE4,
			ToFEN:        afterC5,
			MoveSAN:      "c5",
			MoveUCI:      "c7c5",
			MoveOrder:    1,
		},
	}

	entries, err := polyglot.CompileRepertoire(moves, nil)
	if err != nil {
		t.Fatalf("CompileRepertoire error: %v", err)
	}
	// 1 white move + 2 black candidate moves = 3 entries.
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	var buf bytes.Buffer
	if err := polyglot.WriteBook(&buf, entries); err != nil {
		t.Fatalf("WriteBook error: %v", err)
	}
	book, err := chess.LoadFromReader(&buf)
	if err != nil {
		t.Fatalf("LoadFromReader error: %v", err)
	}

	// Traverse: all book moves should be recovered regardless of side.
	extracted, err := polyglot.TraverseBook(book, "white", 50)
	if err != nil {
		t.Fatalf("TraverseBook error: %v", err)
	}

	// Expect all 3 moves: e2e4 (white) + both black responses e5 and c5.
	if len(extracted) != 3 {
		t.Fatalf("expected 3 extracted moves, got %d", len(extracted))
	}

	ucis := make(map[string]bool)
	for _, ex := range extracted {
		ucis[ex.MoveUCI] = true
	}
	for _, want := range []string{"e2e4", "e7e5", "c7c5"} {
		if !ucis[want] {
			t.Errorf("expected move %q in extracted moves, not found: %v", want, ucis)
		}
	}
}

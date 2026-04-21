package masterdb

import (
	"testing"

	chess "github.com/corentings/chess/v2"
)

func TestMoveFieldOffsets(t *testing.T) {
	// Verify that setMoveFieldsUnsafe correctly sets Move fields by
	// constructing a move and checking all accessors.
	m := &chess.Move{}
	setMoveFieldsUnsafe(m, chess.E2, chess.E4, chess.NoPieceType, chess.Capture)

	if m.S1() != chess.E2 {
		t.Errorf("S1: got %v, want E2 (%d)", m.S1(), chess.E2)
	}
	if m.S2() != chess.E4 {
		t.Errorf("S2: got %v, want E4 (%d)", m.S2(), chess.E4)
	}
	if m.Promo() != chess.NoPieceType {
		t.Errorf("Promo: got %v, want NoPieceType", m.Promo())
	}
	if !m.HasTag(chess.Capture) {
		t.Error("expected Capture tag")
	}

	// Test with promotion.
	m2 := &chess.Move{}
	setMoveFieldsUnsafe(m2, chess.E7, chess.E8, chess.Queen, chess.MoveTag(0))

	if m2.S1() != chess.E7 {
		t.Errorf("S1: got %v, want E7", m2.S1())
	}
	if m2.S2() != chess.E8 {
		t.Errorf("S2: got %v, want E8", m2.S2())
	}
	if m2.Promo() != chess.Queen {
		t.Errorf("Promo: got %v, want Queen", m2.Promo())
	}

	// Test castling tags.
	m3 := &chess.Move{}
	setMoveFieldsUnsafe(m3, chess.E1, chess.G1, chess.NoPieceType, chess.KingSideCastle)
	if !m3.HasTag(chess.KingSideCastle) {
		t.Error("expected KingSideCastle tag")
	}
}

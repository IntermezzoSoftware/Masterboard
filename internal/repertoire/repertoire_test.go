package repertoire

import (
	"strings"
	"testing"
)

func TestPositionFen_FullSixField(t *testing.T) {
	full := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	got := PositionFen(full)
	want := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestPositionFen_StartingPosition(t *testing.T) {
	start := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	got := PositionFen(start)
	want := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestPositionFen_FourFieldsPassthrough(t *testing.T) {
	four := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
	got := PositionFen(four)
	if got != four {
		t.Errorf("4-field FEN should be returned unchanged, got %q", got)
	}
}

func TestPositionFen_FewerThanFiveFields(t *testing.T) {
	short := "8/8/8/8/8/8/8/8 w"
	got := PositionFen(short)
	if got != short {
		t.Errorf("short FEN should be returned unchanged, got %q", got)
	}
}

func TestPositionFen_NoCounterVarianceCollapse(t *testing.T) {
	// Two FENs that represent the same position but differ only in counters
	// should produce identical PositionFen results.
	a := "8/8/8/8/8/8/8/4K2k w - - 0 1"
	b := "8/8/8/8/8/8/8/4K2k w - - 5 42"
	if PositionFen(a) != PositionFen(b) {
		t.Errorf("same position with different counters should collapse to same PositionFen:\n  a=%q\n  b=%q", PositionFen(a), PositionFen(b))
	}
}

func TestPositionFen_EnPassantPreserved(t *testing.T) {
	fen := "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"
	got := PositionFen(fen)
	if !strings.Contains(got, "e6") {
		t.Errorf("en passant square should be preserved: %q", got)
	}
	if strings.Contains(got, "0 2") {
		t.Errorf("halfmove/fullmove should be stripped: %q", got)
	}
}

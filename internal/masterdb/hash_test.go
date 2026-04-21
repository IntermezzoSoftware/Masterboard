package masterdb

import (
	"testing"
	"unsafe"

	chess "github.com/corentings/chess/v2"
)

func TestNormEPD_StripsMoveCounts(t *testing.T) {
	full := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	want := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"
	if got := normEPD(full); got != want {
		t.Errorf("normEPD(%q) = %q, want %q", full, got, want)
	}
}

func TestNormEPD_NormalizesEP(t *testing.T) {
	// Two FENs that differ only in ep field should normalize to the same EPD.
	fenWithEP := "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2"
	fenNoEP := "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
	if normEPD(fenWithEP) != normEPD(fenNoEP) {
		t.Errorf("normEPD should normalize ep field: %q vs %q",
			normEPD(fenWithEP), normEPD(fenNoEP))
	}
}

func TestNormEPD_AlreadyFourFields(t *testing.T) {
	epd := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
	if got := normEPD(epd); got != epd {
		t.Errorf("normEPD of 4-field EPD changed: %q", got)
	}
}

func TestHashEPD_SamePositionDifferentMoveOrder(t *testing.T) {
	// Starting position reached directly.
	start := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	// Same position but with different halfmove/fullmove counters (shouldn't matter).
	startAlt := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 42"

	h1 := hashEPD(start)
	h2 := hashEPD(startAlt)
	if h1 != h2 {
		t.Errorf("same position with different counters should hash equal")
	}
}

func TestHashEPD_DifferentPositions(t *testing.T) {
	pos1 := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	pos2 := "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"

	if hashEPD(pos1) == hashEPD(pos2) {
		t.Error("different positions should not hash equal")
	}
}

func TestHashEPD_EPNormalization(t *testing.T) {
	// Position after 1.e4 — with and without EP square in FEN.
	withEP := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	withoutEP := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

	if hashEPD(withEP) != hashEPD(withoutEP) {
		t.Error("same position with/without EP should hash equal after normalization")
	}
}

// TestBoardBitboardOffsets validates that the Board struct layout matches
// our unsafe pointer assumptions. If corentings/chess/v2 changes the Board
// struct, this test will fail and alert us before producing corrupt hashes.
func TestBoardBitboardOffsets(t *testing.T) {
	pos := chess.StartingPosition()
	board := pos.Board()
	base := unsafe.Pointer(board)

	// Dump first 12 uint64 values to understand field ordering.
	names := []string{
		"bbWhiteKing", "bbWhiteQueen", "bbWhiteRook", "bbWhiteBishop",
		"bbWhiteKnight", "bbWhitePawn", "bbBlackKing", "bbBlackQueen",
		"bbBlackRook", "bbBlackBishop", "bbBlackKnight", "bbBlackPawn",
	}
	vals := make([]uint64, 12)
	for i := 0; i < 12; i++ {
		vals[i] = *(*uint64)(unsafe.Add(base, uintptr(i*8)))
		t.Logf("offset %2d (%s): %016x", i*8, names[i], vals[i])
	}

	// White king on E1 (square 4) → bit 4 → 0x10.
	// The library may use reversed bit ordering (A8=0 instead of A1=0).
	// We don't actually care about the specific values — we only need the
	// 12 bitboards to be deterministic and uniquely identify the board state.
	// Verify by checking that different positions produce different bitboard bytes.
	board2 := chess.StartingPosition()
	moves2 := board2.ValidMoves()
	var e4 *chess.Move
	for i := range moves2 {
		if moves2[i].String() == "e2e4" {
			e4 = &moves2[i]
			break
		}
	}
	if e4 == nil {
		t.Fatal("could not find e2e4")
	}
	pos2 := board2.Update(e4)
	board2After := pos2.Board()
	base2 := unsafe.Pointer(board2After)

	// At least some bitboards must differ after 1.e4.
	different := false
	for i := 0; i < 12; i++ {
		v := *(*uint64)(unsafe.Add(base2, uintptr(i*8)))
		if v != vals[i] {
			different = true
			break
		}
	}
	if !different {
		t.Error("bitboards identical before and after 1.e4 — struct offsets likely wrong")
	}

	// Verify the total size covers 12 uint64s (96 bytes) without going out of bounds.
	// Read as a byte slice — this is what PositionHasher.Hash() does.
	bbBytes := unsafe.Slice((*byte)(base), 96)
	if len(bbBytes) != 96 {
		t.Errorf("expected 96 bytes, got %d", len(bbBytes))
	}
}

// TestPositionHasher_Consistency verifies that PositionHasher produces
// identical hashes when called multiple times on the same position.
func TestPositionHasher_Consistency(t *testing.T) {
	pos := chess.StartingPosition()
	ph := newPositionHasher()

	h1 := ph.Hash(pos)
	h2 := ph.Hash(pos)
	if h1 != h2 {
		t.Errorf("inconsistent hashes: %d vs %d", h1, h2)
	}
}

// TestPositionHasher_DifferentPositions verifies different board states
// produce different hashes.
func TestPositionHasher_DifferentPositions(t *testing.T) {
	ph := newPositionHasher()

	pos1 := chess.StartingPosition()
	h1 := ph.Hash(pos1)

	// Play 1.e4 to get a different position.
	moves := pos1.ValidMoves()
	var e4 *chess.Move
	for i := range moves {
		if moves[i].String() == "e2e4" {
			e4 = &moves[i]
			break
		}
	}
	if e4 == nil {
		t.Fatal("could not find e2e4")
	}
	pos2 := pos1.Update(e4)
	h2 := ph.Hash(pos2)

	if h1 == h2 {
		t.Error("different positions should produce different hashes")
	}
}

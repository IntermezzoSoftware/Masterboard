package masterdb

import (
	"os"
	"sort"
	"testing"

	chess "github.com/corentings/chess/v2"
)

func TestEncodeGame_RoundTrip(t *testing.T) {
	// A short but concrete game: Fool's Mate.
	moveText := "1. f3 e5 2. g4 Qh4# 0-1"
	blob, positions, err := EncodeGame(moveText)
	if err != nil {
		t.Fatalf("EncodeGame: %v", err)
	}
	if len(blob) != 4 {
		t.Fatalf("expected 4 bytes for 4 half-moves, got %d", len(blob))
	}
	if len(positions) != 4 {
		t.Fatalf("expected 4 positions, got %d", len(positions))
	}

	// Decode and verify SAN sequence.
	sans, err := DecodeGame(blob)
	if err != nil {
		t.Fatalf("DecodeGame: %v", err)
	}
	want := []string{"f3", "e5", "g4", "Qh4#"}
	if len(sans) != len(want) {
		t.Fatalf("decoded %d moves, want %d", len(sans), len(want))
	}
	for i, s := range sans {
		if s != want[i] {
			t.Errorf("move %d: got %q, want %q", i, s, want[i])
		}
	}
}

func TestEncodeGame_PositionHashes(t *testing.T) {
	// Verify that positions have non-zero hashes and each is populated.
	moveText := "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0"
	_, positions, err := EncodeGame(moveText)
	if err != nil {
		t.Fatalf("EncodeGame: %v", err)
	}
	if len(positions) != 6 {
		t.Fatalf("expected 6 positions, got %d", len(positions))
	}

	for i, p := range positions {
		if p.Hash == 0 {
			t.Errorf("position %d has zero hash", i)
		}
		if p.MoveSAN == "" {
			t.Errorf("position %d has empty SAN", i)
		}
	}
}

func TestEncodeGame_TranspositionHashes(t *testing.T) {
	// Two different move orders reaching the same position should produce the
	// same hash for that position.
	//
	// King's Pawn opening transposition:
	// Order A: 1.e4 e5 2.Nf3 — position after 1.e4 e5
	// Order B: 1.e4 e5 2.Bc4 — position after 1.e4 e5 is the same
	moveTextA := "1. e4 e5 2. Nf3 1-0"
	moveTextB := "1. e4 e5 2. Bc4 1-0"

	_, posA, err := EncodeGame(moveTextA)
	if err != nil {
		t.Fatal(err)
	}
	_, posB, err := EncodeGame(moveTextB)
	if err != nil {
		t.Fatal(err)
	}

	// posA[0] and posB[0] are both the starting position (before 1.e4).
	if posA[0].Hash != posB[0].Hash {
		t.Error("starting position hash should be equal across game sequences")
	}
	// posA[1] and posB[1] are both the position after 1.e4 (before 1...e5).
	if posA[1].Hash != posB[1].Hash {
		t.Error("position after 1.e4 should be equal across game sequences")
	}
	// posA[2] and posB[2] are both the position after 1.e4 e5 (before White's 2nd move).
	if posA[2].Hash != posB[2].Hash {
		t.Error("position after 1.e4 e5 should be equal across game sequences")
	}
}

func TestEncodeGame_EmptyMoveText(t *testing.T) {
	// A game with no moves (just result token) should encode to empty blob.
	blob, positions, err := EncodeGame("*")
	if err != nil {
		t.Fatalf("EncodeGame: %v", err)
	}
	if len(blob) != 0 {
		t.Errorf("expected empty blob for no moves, got %d bytes", len(blob))
	}
	if len(positions) != 0 {
		t.Errorf("expected 0 positions, got %d", len(positions))
	}
}

func TestDecodeGame_InvalidByte(t *testing.T) {
	// From start position there are 20 legal moves. Byte 200 should fail.
	_, err := DecodeGame([]byte{200})
	if err == nil {
		t.Error("expected error for out-of-range byte, got nil")
	}
}

func TestEncodeGame_LongerGame(t *testing.T) {
	// Verify a real game-like sequence encodes and decodes correctly.
	moveText := "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 O-O 5. Bd3 d5 6. Nf3 c5 7. O-O Nc6 1/2-1/2"
	blob, _, err := EncodeGame(moveText)
	if err != nil {
		t.Fatalf("EncodeGame: %v", err)
	}
	// 14 half-moves (7 full moves).
	if len(blob) != 14 {
		t.Errorf("expected 14 bytes, got %d", len(blob))
	}

	sans, err := DecodeGame(blob)
	if err != nil {
		t.Fatalf("DecodeGame: %v", err)
	}
	want := []string{"d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "e3", "O-O", "Bd3", "d5", "Nf3", "c5", "O-O", "Nc6"}
	for i, s := range sans {
		if s != want[i] {
			t.Errorf("move %d: got %q, want %q", i, s, want[i])
		}
	}
}

// TestpositionHasherConsistency verifies that positionHasher.Hash produces
// the same result when called twice on the same position, and different
// results for different positions across a sequence of moves.
func TestPositionHasherConsistency(t *testing.T) {
	ph := newPositionHasher()
	pos := chess.StartingPosition()

	// Starting position should hash consistently.
	h1 := ph.Hash(pos)
	h2 := ph.Hash(pos)
	if h1 != h2 {
		t.Errorf("starting position: inconsistent hashes %016x vs %016x", uint64(h1), uint64(h2))
	}

	// Play several moves; each position should produce a unique hash.
	seen := map[int64]string{h1: "start"}
	moves := []string{"e4", "e5", "Nf3", "Nc6", "Bb5", "a6"}
	for _, san := range moves {
		comp := parseSAN(san)
		legal := pos.ValidMoves()
		m := matchLegalMove(legal, pos, comp)
		if m == nil {
			t.Fatalf("move %q not found", san)
		}
		pos = pos.Update(m)

		h := ph.Hash(pos)
		if prev, ok := seen[h]; ok {
			t.Errorf("hash collision after %s: same as %s (%016x)", san, prev, uint64(h))
		}
		seen[h] = san

		// Consistency: same position hashes the same.
		h2 = ph.Hash(pos)
		if h != h2 {
			t.Errorf("after %s: inconsistent hashes %016x vs %016x", san, uint64(h), uint64(h2))
		}
	}
}

// TestMoveUCIKeyEquivalence verifies that moveUCIKey produces the same
// sort ordering as alphabetical UCI strings (Move.String()) across diverse
// positions: starting position, castling, promotions, en passant, middlegame.
func TestMoveUCIKeyEquivalence(t *testing.T) {
	testCases := []struct {
		name     string
		moveText string // game leading to the position to test (empty = starting pos)
	}{
		{"starting position", ""},
		{"after 1.e4 (pawn structure)", "1. e4"},
		{"castling available (after Nf3 Nc6 Bc4 Bc5 d3 d6)", "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. O-O"},
		{"after 1.d4 Nf6 2.c4 e6 (closed)", "1. d4 Nf6 2. c4 e6"},
		{"complex middlegame", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			pos := chess.StartingPosition()
			if tc.moveText != "" {
				// Replay moves to reach the desired position.
				sans := tokenizeMoveText(tc.moveText)
				for _, san := range sans {
					comp := parseSAN(san)
					legal := pos.ValidMoves()
					m := matchLegalMove(legal, pos, comp)
					if m == nil {
						t.Fatalf("move %q not found", san)
					}
					pos = pos.Update(m)
				}
			}

			legal := pos.ValidMoves()
			if len(legal) == 0 {
				t.Skip("no legal moves")
			}

			// Sort by UCI string (old method).
			type strEntry struct {
				uci string
				idx int
			}
			byStr := make([]strEntry, len(legal))
			for i := range legal {
				byStr[i] = strEntry{uci: (&legal[i]).String(), idx: i}
			}
			sort.Slice(byStr, func(a, b int) bool { return byStr[a].uci < byStr[b].uci })

			// Sort by integer key (new method).
			type keyEntry struct {
				key uint32
				idx int
			}
			byKey := make([]keyEntry, len(legal))
			for i := range legal {
				byKey[i] = keyEntry{key: moveUCIKey(&legal[i]), idx: i}
			}
			sort.Slice(byKey, func(a, b int) bool { return byKey[a].key < byKey[b].key })

			// Assert identical ordering.
			for i := range byStr {
				if byStr[i].idx != byKey[i].idx {
					t.Errorf("position %d: string sort[%d]=%s (move %d) but key sort[%d]=key %d (move %d)",
						i, i, byStr[i].uci, byStr[i].idx, i, byKey[i].key, byKey[i].idx)
				}
			}
		})
	}
}

// TestMoveUCIKeyEquivalence_Promotions specifically tests positions with
// promotions available to verify promo sort ordering (b < n < q < r).
func TestMoveUCIKeyEquivalence_Promotions(t *testing.T) {
	// Position where white pawn on e7 can promote: reach via contrived game.
	// FEN: 4k3/4P3/8/8/8/8/8/4K3 w - - 0 1 (white pawn on e7, can promote)
	// We can't easily set up arbitrary FEN through the chess library's game API,
	// so test promotion ordering via the key function directly.
	promoTypes := []chess.PieceType{chess.NoPieceType, chess.Bishop, chess.Knight, chess.Queen, chess.Rook}
	var keys []uint32
	for _, pt := range promoTypes {
		m := chess.Move{}
		// We can't easily construct a Move with specific promo from outside the library,
		// so verify the promoSortKey function matches alphabetical order instead.
		_ = m
		keys = append(keys, promoSortKey(pt))
	}
	// Expected alphabetical order of UCI promo chars: "" < "b" < "n" < "q" < "r"
	for i := 1; i < len(keys); i++ {
		if keys[i] <= keys[i-1] {
			t.Errorf("promo sort order wrong: key[%d]=%d should be > key[%d]=%d", i, keys[i], i-1, keys[i-1])
		}
	}
}

// BenchmarkEncodeGame benchmarks the full encode pipeline (parse SAN + ValidMoves + sort + hash).
// Use with -cpuprofile to identify bottlenecks:
//
//	go test -bench=BenchmarkEncodeGame -cpuprofile=cpu.prof -benchtime=30s ./internal/masterdb/
//	go tool pprof -top cpu.prof
func BenchmarkEncodeGame(b *testing.B) {
	// Collect move texts from gigabase_small for a realistic distribution.
	pgnFiles := []string{
		"../../tmp/gigabase_small/LumbrasGigaBase_OTB_0001-1899.pgn",
		"../../tmp/gigabase_small/LumbrasGigaBase_OTB_1900-1949.pgn",
		"../../tmp/gigabase_small/LumbrasGigaBase_OTB_noDate.pgn",
	}

	var moveTexts []string
	for _, f := range pgnFiles {
		if _, err := os.Stat(f); err != nil {
			b.Skipf("gigabase_small not available: %v", err)
		}
		_ = ParseFile(f, func(pg ParsedGame) {
			if len(moveTexts) < 5000 {
				moveTexts = append(moveTexts, pg.MoveText)
			}
		})
		if len(moveTexts) >= 5000 {
			break
		}
	}
	if len(moveTexts) == 0 {
		b.Skip("no games parsed")
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		mt := moveTexts[i%len(moveTexts)]
		EncodeGame(mt)
	}
}

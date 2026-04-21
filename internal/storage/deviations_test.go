package storage

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// insertTestGame saves a minimal game with the given white, black, and PGN.
func insertTestGame(t *testing.T, db *DB, white, black, pgn string) string {
	t.Helper()
	id, err := db.SaveGame(game.GameInput{
		White:    white,
		Black:    black,
		Result:   "*",
		Source:   "manual",
		SourceID: "",
		PGN:      pgn,
	})
	if err != nil {
		t.Fatalf("insertTestGame: %v", err)
	}
	return id
}

// insertTestRepertoire creates a repertoire with the given colour and returns its ID.
func insertTestRepertoire(t *testing.T, db *DB, colour string) string {
	t.Helper()
	id, err := db.CreateRepertoire("Test Repertoire", colour)
	if err != nil {
		t.Fatalf("insertTestRepertoire: %v", err)
	}
	return id
}

// insertRepMove saves a single repertoire move (from_fen → san → to_fen).
func insertRepMove(t *testing.T, db *DB, repID, fromFEN, san, uci, toFEN string) {
	t.Helper()
	_, err := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: repID,
		FromFEN:      fromFEN,
		ToFEN:        toFEN,
		MoveSAN:      san,
		MoveUCI:      uci,
	})
	if err != nil {
		t.Fatalf("insertRepMove(%s): %v", san, err)
	}
}

// TestDetectDeviation_PlayerOffBook: Magnus (White) plays 1.d4 but repertoire has only 1.e4.
func TestDetectDeviation_PlayerOffBook(t *testing.T) {
	db := openTestDB(t)
	db.SetSetting("identity.displayName", "Magnus") //nolint:errcheck

	// Create a white repertoire with 1.e4 prepared.
	repID := insertTestRepertoire(t, db, "white")
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4FEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	insertRepMove(t, db, repID, startFEN, "e4", "e2e4", afterE4FEN)

	// Magnus plays 1.d4 (off-book).
	gameID := insertTestGame(t, db, "Magnus", "Opponent", `[White "Magnus"][Black "Opponent"][Result "*"] 1. d4 *`)

	result, err := db.DetectDeviation(gameID)
	if err != nil {
		t.Fatalf("DetectDeviation error: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.DeviationPly != 0 {
		t.Errorf("DeviationPly = %d, want 0", result.DeviationPly)
	}
	if !result.PlayerWentOffBook {
		t.Error("PlayerWentOffBook = false, want true")
	}
	if result.PlayedMove != "d4" {
		t.Errorf("PlayedMove = %q, want d4", result.PlayedMove)
	}
	found := false
	for _, m := range result.ExpectedMoves {
		if m == "e4" {
			found = true
		}
	}
	if !found {
		t.Errorf("ExpectedMoves = %v, want to contain e4", result.ExpectedMoves)
	}
}

// TestDetectDeviation_OpponentOffBook: Magnus plays 1.e4, repertoire expects 1...e5, opponent plays 1...c5.
func TestDetectDeviation_OpponentOffBook(t *testing.T) {
	db := openTestDB(t)
	db.SetSetting("identity.displayName", "Magnus") //nolint:errcheck

	repID := insertTestRepertoire(t, db, "white")
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4FEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	afterE5FEN := "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
	insertRepMove(t, db, repID, startFEN, "e4", "e2e4", afterE4FEN)
	insertRepMove(t, db, repID, afterE4FEN, "e5", "e7e5", afterE5FEN)

	// Opponent plays c5 instead of e5.
	gameID := insertTestGame(t, db, "Magnus", "Opponent", `[White "Magnus"][Black "Opponent"][Result "*"] 1. e4 c5 *`)

	result, err := db.DetectDeviation(gameID)
	if err != nil {
		t.Fatalf("DetectDeviation error: %v", err)
	}
	if result.DeviationPly != 1 {
		t.Errorf("DeviationPly = %d, want 1", result.DeviationPly)
	}
	if result.PlayerWentOffBook {
		t.Error("PlayerWentOffBook = true, want false (opponent went off-book)")
	}
	if result.PlayedMove != "c5" {
		t.Errorf("PlayedMove = %q, want c5", result.PlayedMove)
	}
}

// TestDetectDeviation_FullyInRepertoire: game stays in repertoire → deviationPly = -1.
func TestDetectDeviation_FullyInRepertoire(t *testing.T) {
	db := openTestDB(t)
	db.SetSetting("identity.displayName", "Magnus") //nolint:errcheck

	repID := insertTestRepertoire(t, db, "white")
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4FEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	afterE5FEN := "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
	insertRepMove(t, db, repID, startFEN, "e4", "e2e4", afterE4FEN)
	insertRepMove(t, db, repID, afterE4FEN, "e5", "e7e5", afterE5FEN)

	gameID := insertTestGame(t, db, "Magnus", "Opponent", `[White "Magnus"][Black "Opponent"][Result "*"] 1. e4 e5 *`)

	result, err := db.DetectDeviation(gameID)
	if err != nil {
		t.Fatalf("DetectDeviation error: %v", err)
	}
	if result.DeviationPly != -1 {
		t.Errorf("DeviationPly = %d, want -1 (fully in repertoire)", result.DeviationPly)
	}
}

// TestDetectDeviation_NotPersonalGame: no identity match → deviationPly = -1.
func TestDetectDeviation_NotPersonalGame(t *testing.T) {
	db := openTestDB(t)
	// No identity set.

	gameID := insertTestGame(t, db, "Carlsen", "Nepomniachtchi", `[White "Carlsen"][Black "Nepomniachtchi"][Result "*"] 1. e4 *`)

	result, err := db.DetectDeviation(gameID)
	if err != nil {
		t.Fatalf("DetectDeviation error: %v", err)
	}
	if result.DeviationPly != -1 {
		t.Errorf("DeviationPly = %d, want -1 (not personal game)", result.DeviationPly)
	}
}

// TestDetectDeviation_CacheHit: second call returns cached result without re-computing.
func TestDetectDeviation_CacheHit(t *testing.T) {
	db := openTestDB(t)
	db.SetSetting("identity.displayName", "Magnus") //nolint:errcheck

	repID := insertTestRepertoire(t, db, "white")
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4FEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	insertRepMove(t, db, repID, startFEN, "e4", "e2e4", afterE4FEN)

	gameID := insertTestGame(t, db, "Magnus", "Opponent", `[White "Magnus"][Black "Opponent"][Result "*"] 1. d4 *`)

	r1, err1 := db.DetectDeviation(gameID)
	r2, err2 := db.DetectDeviation(gameID)
	if err1 != nil || err2 != nil {
		t.Fatalf("errors: %v, %v", err1, err2)
	}
	if r1 == nil || r2 == nil {
		t.Fatal("nil result")
	}
	if r1.DeviationPly != r2.DeviationPly {
		t.Errorf("cache mismatch: ply %d vs %d", r1.DeviationPly, r2.DeviationPly)
	}
}

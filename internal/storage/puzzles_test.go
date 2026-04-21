package storage

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

// puzzleTestEval mirrors analysis.MoveEval for test marshalling.
type puzzleTestEval struct {
	Ply      int     `json:"ply"`
	BestCp   *int    `json:"bestCp"`
	BestPV   string  `json:"bestPv"`
	Accuracy float64 `json:"accuracy"`
	Nag      *int    `json:"nag"`
}

// seedPuzzleGame inserts a game and a complete analysis with a blunder at ply 2
// (Black's first move: e7e5). Returns the game ID.
func seedPuzzleGame(t *testing.T, db *DB) string {
	t.Helper()
	// A short game: 1.e4 e5 2.Qh5 — Scholar's mate approach.
	pgn := "[White \"Alice\"]\n[Black \"Bob\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Qh5 1-0"
	gi := game.GameInput{
		White:    "Alice",
		Black:    "Bob",
		Result:   "1-0",
		Source:   "lichess",
		SourceID: "puzzle-test-1",
		PGN:      pgn,
	}
	gameID, err := db.SaveGame(gi)
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	nagBlunder := 4
	cp := 50
	// Ply 2 = black's first move (e7e5). Engine suggests d7d5 as the best move.
	evals := []puzzleTestEval{
		{Ply: 1, BestCp: &cp, BestPV: "e2e4", Accuracy: 85.0},
		{Ply: 2, BestCp: &cp, BestPV: "d7d5", Accuracy: 30.0, Nag: &nagBlunder},
		{Ply: 3, BestCp: &cp, BestPV: "d1h5", Accuracy: 90.0},
	}
	evalsJSON, err := json.Marshal(evals)
	if err != nil {
		t.Fatalf("marshal evals: %v", err)
	}

	_, err = db.db.Exec(`
		INSERT INTO game_analyses
			(game_id, depth, status, white_accuracy, black_accuracy,
			 evals, analysed_at, created_at, updated_at)
		VALUES (?, 22, 'complete', 90.0, 30.0, ?, '2024-01-01T12:00:00Z',
		        '2024-01-01T12:00:00Z', '2024-01-01T12:00:00Z')`,
		gameID, string(evalsJSON))
	if err != nil {
		t.Fatalf("insert game_analysis: %v", err)
	}
	return gameID
}

// insertBarePuzzle inserts a fake puzzle directly into personal_puzzles (bypassing
// ExtractPuzzles) for session/count tests that don't need real PGN parsing.
func insertBarePuzzle(t *testing.T, db *DB, idx int) string {
	t.Helper()
	gameID := fmt.Sprintf("game-bare-%d", idx)
	pid := puzzleID(gameID, idx)

	if _, err := db.db.Exec(`
		INSERT OR IGNORE INTO games (id, white, black, result, pgn, created_at, updated_at)
		VALUES (?, 'A', 'B', '1-0', '1. e4 1-0', datetime('now'), datetime('now'))`, gameID); err != nil {
		t.Fatalf("insert bare game %d: %v", idx, err)
	}
	if _, err := db.db.Exec(`
		INSERT OR IGNORE INTO personal_puzzles
			(id, game_id, ply, fen, solution_uci, solution_san, played_move, classification, player_colour, created_at)
		VALUES (?, ?, ?, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
		        '["d7d5"]', '["d5"]', 'e5', 'blunder', 'black', datetime('now'))`,
		pid, gameID, idx); err != nil {
		t.Fatalf("insert bare puzzle %d: %v", idx, err)
	}
	return pid
}

func TestExtractPuzzles(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)

	count, err := db.ExtractPuzzles(gameID)
	if err != nil {
		t.Fatalf("ExtractPuzzles: %v", err)
	}
	if count != 1 {
		t.Errorf("ExtractPuzzles count = %d, want 1", count)
	}

	// Verify the puzzle row.
	var id, storedGameID, classification, playerColour string
	var ply int
	err = db.db.QueryRow(
		`SELECT id, game_id, ply, classification, player_colour FROM personal_puzzles WHERE game_id = ?`,
		gameID,
	).Scan(&id, &storedGameID, &ply, &classification, &playerColour)
	if err != nil {
		t.Fatalf("query puzzle row: %v", err)
	}
	if storedGameID != gameID {
		t.Errorf("game_id = %q, want %q", storedGameID, gameID)
	}
	if ply != 2 {
		t.Errorf("ply = %d, want 2", ply)
	}
	if classification != "blunder" {
		t.Errorf("classification = %q, want %q", classification, "blunder")
	}
	if playerColour != "black" {
		t.Errorf("player_colour = %q, want %q", playerColour, "black")
	}
	wantID := puzzleID(gameID, 2)
	if id != wantID {
		t.Errorf("id = %q, want %q", id, wantID)
	}
}

func TestExtractPuzzlesIdempotent(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)

	n1, err := db.ExtractPuzzles(gameID)
	if err != nil {
		t.Fatalf("first ExtractPuzzles: %v", err)
	}
	if n1 != 1 {
		t.Fatalf("first call inserted %d, want 1", n1)
	}

	n2, err := db.ExtractPuzzles(gameID)
	if err != nil {
		t.Fatalf("second ExtractPuzzles: %v", err)
	}
	if n2 != 0 {
		t.Errorf("second ExtractPuzzles inserted %d, want 0", n2)
	}

	var rowCount int
	db.db.QueryRow(`SELECT COUNT(*) FROM personal_puzzles WHERE game_id = ?`, gameID).Scan(&rowCount) //nolint:errcheck
	if rowCount != 1 {
		t.Errorf("personal_puzzles row count = %d, want 1", rowCount)
	}
}

func TestGetPuzzleSession(t *testing.T) {
	db := openTestDB(t)

	// 2 new puzzles (no SRS entry → immediately due).
	p1 := insertBarePuzzle(t, db, 1)
	p2 := insertBarePuzzle(t, db, 2)
	// 1 puzzle with a far-future due → not due.
	p3 := insertBarePuzzle(t, db, 3)
	futureStr := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	if _, err := db.db.Exec(`
		INSERT INTO srs_puzzle_entries (puzzle_id, due) VALUES (?, ?)`, p3, futureStr); err != nil {
		t.Fatalf("insert future srs entry: %v", err)
	}

	session, err := db.GetPuzzleSession(10, PuzzleFilters{})
	if err != nil {
		t.Fatalf("GetPuzzleSession: %v", err)
	}
	if len(session) != 2 {
		t.Errorf("session len = %d, want 2", len(session))
	}

	ids := map[string]bool{}
	for _, p := range session {
		ids[p.ID] = true
	}
	if !ids[p1] {
		t.Errorf("puzzle %s not in session", p1)
	}
	if !ids[p2] {
		t.Errorf("puzzle %s not in session", p2)
	}
	if ids[p3] {
		t.Errorf("future puzzle %s should not be in session", p3)
	}
}

func TestRecordPuzzleResult(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)

	count, err := db.ExtractPuzzles(gameID)
	if err != nil || count == 0 {
		t.Fatalf("ExtractPuzzles: count=%d err=%v", count, err)
	}

	pid := puzzleID(gameID, 2)
	if err := db.RecordPuzzleResult(pid, true); err != nil {
		t.Fatalf("RecordPuzzleResult: %v", err)
	}

	// SRS entry must exist with a due date in the future.
	var dueStr string
	if err := db.db.QueryRow(`SELECT due FROM srs_puzzle_entries WHERE puzzle_id = ?`, pid).Scan(&dueStr); err != nil {
		t.Fatalf("query srs_puzzle_entries: %v", err)
	}
	due, err := time.Parse(time.RFC3339, dueStr)
	if err != nil {
		t.Fatalf("parse due: %v", err)
	}
	if !due.After(time.Now()) {
		t.Errorf("due = %v, expected future date after correct answer", due)
	}
}

func TestGetPuzzleSummary(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)
	count, err := db.ExtractPuzzles(gameID)
	if err != nil || count == 0 {
		t.Fatalf("ExtractPuzzles: count=%d err=%v", count, err)
	}

	pid := puzzleID(gameID, 2)
	since := time.Now().Add(-time.Minute)

	if err := db.RecordPuzzleResult(pid, true); err != nil {
		t.Fatalf("RecordPuzzleResult correct: %v", err)
	}
	if err := db.RecordPuzzleResult(pid, false); err != nil {
		t.Fatalf("RecordPuzzleResult incorrect: %v", err)
	}

	summary, err := db.GetPuzzleSummary(since)
	if err != nil {
		t.Fatalf("GetPuzzleSummary: %v", err)
	}
	if summary.TotalReviewed != 2 {
		t.Errorf("TotalReviewed = %d, want 2", summary.TotalReviewed)
	}
	if summary.CorrectCount != 1 {
		t.Errorf("CorrectCount = %d, want 1", summary.CorrectCount)
	}
	if summary.IncorrectCount != 1 {
		t.Errorf("IncorrectCount = %d, want 1", summary.IncorrectCount)
	}
	// First review was on a New card → promoted to Learning/Review → NewToLearning = 1.
	if summary.NewToLearning != 1 {
		t.Errorf("NewToLearning = %d, want 1", summary.NewToLearning)
	}
	// Neither review was on a card in Review state (state_before=2) answered Again —
	// the card started as New (state_before=0) so LapsedToRelearn must be 0.
	if summary.LapsedToRelearn != 0 {
		t.Errorf("LapsedToRelearn = %d, want 0", summary.LapsedToRelearn)
	}
}

func TestGetPuzzleCount(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)
	count, err := db.ExtractPuzzles(gameID)
	if err != nil || count == 0 {
		t.Fatalf("ExtractPuzzles: count=%d err=%v", count, err)
	}

	// New puzzle → no SRS entry → due immediately → count = 1.
	n, err := db.GetPuzzleCount()
	if err != nil {
		t.Fatalf("GetPuzzleCount: %v", err)
	}
	if n != 1 {
		t.Errorf("initial count = %d, want 1", n)
	}

	// Correct answer → FSRS schedules for the future → count drops to 0.
	pid := puzzleID(gameID, 2)
	if err := db.RecordPuzzleResult(pid, true); err != nil {
		t.Fatalf("RecordPuzzleResult: %v", err)
	}

	n2, err := db.GetPuzzleCount()
	if err != nil {
		t.Fatalf("GetPuzzleCount after review: %v", err)
	}
	if n2 != 0 {
		t.Errorf("count after review = %d, want 0", n2)
	}
}

func TestGetTacticsLobbyStats(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)

	// Before extraction: no puzzles, no reviews.
	stats, err := db.GetTacticsLobbyStats(PuzzleFilters{})
	if err != nil {
		t.Fatalf("GetTacticsLobbyStats (empty): %v", err)
	}
	if stats.TotalPuzzles != 0 {
		t.Errorf("TotalPuzzles = %d, want 0", stats.TotalPuzzles)
	}
	if stats.DueCount != 0 {
		t.Errorf("DueCount = %d, want 0", stats.DueCount)
	}
	if stats.LifetimeTotal != 0 {
		t.Errorf("LifetimeTotal = %d, want 0", stats.LifetimeTotal)
	}

	// Extract a puzzle.
	if _, err := db.ExtractPuzzles(gameID); err != nil {
		t.Fatalf("ExtractPuzzles: %v", err)
	}

	stats, err = db.GetTacticsLobbyStats(PuzzleFilters{})
	if err != nil {
		t.Fatalf("GetTacticsLobbyStats (after extract): %v", err)
	}
	if stats.TotalPuzzles != 1 {
		t.Errorf("TotalPuzzles = %d, want 1", stats.TotalPuzzles)
	}
	if stats.DueCount != 1 {
		t.Errorf("DueCount = %d, want 1 (new puzzle is due)", stats.DueCount)
	}
	if stats.LifetimeTotal != 0 {
		t.Errorf("LifetimeTotal = %d, want 0 (no reviews yet)", stats.LifetimeTotal)
	}

	// Record a correct review — lifetime counts should update.
	pid := puzzleID(gameID, 2)
	if err := db.RecordPuzzleResult(pid, true); err != nil {
		t.Fatalf("RecordPuzzleResult: %v", err)
	}

	stats, err = db.GetTacticsLobbyStats(PuzzleFilters{})
	if err != nil {
		t.Fatalf("GetTacticsLobbyStats (after review): %v", err)
	}
	if stats.LifetimeTotal != 1 {
		t.Errorf("LifetimeTotal = %d, want 1", stats.LifetimeTotal)
	}
	if stats.LifetimeCorrect != 1 {
		t.Errorf("LifetimeCorrect = %d, want 1", stats.LifetimeCorrect)
	}
	// Due count should drop to 0 after a correct review (FSRS schedules for future).
	if stats.DueCount != 0 {
		t.Errorf("DueCount = %d, want 0 (correct review schedules future)", stats.DueCount)
	}
}

func TestGetPuzzleHistory(t *testing.T) {
	db := openTestDB(t)
	gameID := seedPuzzleGame(t, db)

	if _, err := db.ExtractPuzzles(gameID); err != nil {
		t.Fatalf("ExtractPuzzles: %v", err)
	}

	// No reviews yet → history should be empty.
	entries, err := db.GetPuzzleHistory(10, 0)
	if err != nil {
		t.Fatalf("GetPuzzleHistory (empty): %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("history len = %d, want 0", len(entries))
	}

	// Record an incorrect then a correct review.
	pid := puzzleID(gameID, 2)
	if err := db.RecordPuzzleResult(pid, false); err != nil {
		t.Fatalf("RecordPuzzleResult (incorrect): %v", err)
	}
	if err := db.RecordPuzzleResult(pid, true); err != nil {
		t.Fatalf("RecordPuzzleResult (correct): %v", err)
	}

	// History should show 2 rows (most recent first).
	entries, err = db.GetPuzzleHistory(10, 0)
	if err != nil {
		t.Fatalf("GetPuzzleHistory (after reviews): %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("history len = %d, want 2", len(entries))
	}
	// Most recent first: correct review came second.
	if !entries[0].Correct {
		t.Errorf("entries[0].Correct = false, want true (correct review is most recent)")
	}
	if entries[1].Correct {
		t.Errorf("entries[1].Correct = true, want false (incorrect review is older)")
	}
	// Game fields should be populated via the JOIN.
	if entries[0].White != "Alice" {
		t.Errorf("entries[0].White = %q, want %q", entries[0].White, "Alice")
	}
	if entries[0].Black != "Bob" {
		t.Errorf("entries[0].Black = %q, want %q", entries[0].Black, "Bob")
	}
	if entries[0].GameID != gameID {
		t.Errorf("entries[0].GameID = %q, want %q", entries[0].GameID, gameID)
	}

	// Pagination: limit=1, offset=0 should return only the most recent entry.
	page, err := db.GetPuzzleHistory(1, 0)
	if err != nil {
		t.Fatalf("GetPuzzleHistory (paginated): %v", err)
	}
	if len(page) != 1 {
		t.Fatalf("paginated len = %d, want 1", len(page))
	}
	if !page[0].Correct {
		t.Errorf("page[0].Correct = false, want true")
	}

	// Offset=1 should return the older entry.
	page2, err := db.GetPuzzleHistory(1, 1)
	if err != nil {
		t.Fatalf("GetPuzzleHistory (offset 1): %v", err)
	}
	if len(page2) != 1 {
		t.Fatalf("page2 len = %d, want 1", len(page2))
	}
	if page2[0].Correct {
		t.Errorf("page2[0].Correct = true, want false")
	}
}

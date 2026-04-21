package storage

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
	"github.com/IntermezzoSoftware/Masterboard/internal/masterdb"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// seedReportsGames inserts games for the reports tests and returns their IDs.
// Layout:
//
//	idx 0,1  — Magnus Carlsen (white or black), no analysis  → unanalyzed
//	idx 2    — Magnus Carlsen (white), analysis complete     → should be excluded
//	idx 3    — Anand (white), no analysis                   → unanalyzed
func seedReportsGames(t *testing.T, db *DB) []string {
	t.Helper()
	inputs := []game.GameInput{
		{
			White: "Magnus Carlsen", Black: "Fabiano Caruana", Result: "1-0",
			Source: "lichess", SourceID: "rep-test-1",
			PGN: "[White \"Magnus Carlsen\"]\n[Black \"Fabiano Caruana\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0",
		},
		{
			White: "Ian Nepomniachtchi", Black: "Magnus Carlsen", Result: "0-1",
			Source: "lichess", SourceID: "rep-test-2",
			PGN: "[White \"Ian Nepomniachtchi\"]\n[Black \"Magnus Carlsen\"]\n[Result \"0-1\"]\n\n1. d4 d5 0-1",
		},
		{
			White: "Magnus Carlsen", Black: "Levon Aronian", Result: "1-0",
			Source: "lichess", SourceID: "rep-test-3",
			PGN: "[White \"Magnus Carlsen\"]\n[Black \"Levon Aronian\"]\n[Result \"1-0\"]\n\n1. c4 e5 1-0",
		},
		{
			White: "Anand", Black: "Peter Svidler", Result: "1/2-1/2",
			Source: "lichess", SourceID: "rep-test-4",
			PGN: "[White \"Anand\"]\n[Black \"Peter Svidler\"]\n[Result \"1/2-1/2\"]\n\n1. e4 c5 1/2-1/2",
		},
	}

	ids := make([]string, len(inputs))
	for i, inp := range inputs {
		id, err := db.SaveGame(inp)
		if err != nil {
			t.Fatalf("seedReportsGames[%d]: %v", i, err)
		}
		ids[i] = id
	}

	// Mark game at idx 2 (Magnus Carlsen white, vs Aronian) as complete.
	if err := db.UpsertGameAnalysis(ids[2], 22, "complete"); err != nil {
		t.Fatalf("seed analysis complete: %v", err)
	}

	return ids
}

func TestGetUnanalyzedGameIDsForPlayer_Basic(t *testing.T) {
	db := openTestDB(t)
	seedReportsGames(t, db)

	ids, err := db.GetUnanalyzedGameIDsForPlayer([]string{"Magnus Carlsen"}, 0)
	if err != nil {
		t.Fatalf("GetUnanalyzedGameIDsForPlayer: %v", err)
	}
	if len(ids) != 2 {
		t.Errorf("expected 2 unanalyzed games for Magnus Carlsen, got %d", len(ids))
	}
}

func TestGetUnanalyzedGameIDsForPlayer_CaseInsensitive(t *testing.T) {
	db := openTestDB(t)
	seedReportsGames(t, db)

	ids, err := db.GetUnanalyzedGameIDsForPlayer([]string{"MAGNUS CARLSEN"}, 0)
	if err != nil {
		t.Fatalf("GetUnanalyzedGameIDsForPlayer: %v", err)
	}
	if len(ids) != 2 {
		t.Errorf("expected 2 unanalyzed games (case-insensitive), got %d", len(ids))
	}
}

func TestGetUnanalyzedGameIDsForPlayer_SinglePlayer(t *testing.T) {
	db := openTestDB(t)
	seedReportsGames(t, db)

	ids, err := db.GetUnanalyzedGameIDsForPlayer([]string{"Anand"}, 0)
	if err != nil {
		t.Fatalf("GetUnanalyzedGameIDsForPlayer: %v", err)
	}
	if len(ids) != 1 {
		t.Errorf("expected 1 unanalyzed game for Anand, got %d", len(ids))
	}
}

func TestGetUnanalyzedGameIDsForPlayer_Limit(t *testing.T) {
	db := openTestDB(t)
	seedReportsGames(t, db)

	ids, err := db.GetUnanalyzedGameIDsForPlayer([]string{"Magnus Carlsen"}, 1)
	if err != nil {
		t.Fatalf("GetUnanalyzedGameIDsForPlayer: %v", err)
	}
	if len(ids) != 1 {
		t.Errorf("expected exactly 1 ID with limit=1, got %d", len(ids))
	}
}


func seedPlayerNamesGames(t *testing.T, db *DB) {
	t.Helper()
	inputs := []game.GameInput{
		{
			White: "Magnus Carlsen", Black: "Viswanathan Anand", Result: "1-0",
			Source: "lichess", SourceID: "pn-test-1",
			PGN: "[White \"Magnus Carlsen\"]\n[Black \"Viswanathan Anand\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0",
		},
		{
			White: "Magnus C", Black: "Fabiano Caruana", Result: "0-1",
			Source: "lichess", SourceID: "pn-test-2",
			PGN: "[White \"Magnus C\"]\n[Black \"Fabiano Caruana\"]\n[Result \"0-1\"]\n\n1. d4 d5 0-1",
		},
	}
	for i, inp := range inputs {
		if _, err := db.SaveGame(inp); err != nil {
			t.Fatalf("seedPlayerNamesGames[%d]: %v", i, err)
		}
	}
}

func TestGetPlayerNames_PrefixMag(t *testing.T) {
	db := openTestDB(t)
	seedPlayerNamesGames(t, db)

	names, err := db.GetPlayerNames("Mag", 0)
	if err != nil {
		t.Fatalf("GetPlayerNames: %v", err)
	}
	if len(names) != 2 {
		t.Errorf("expected 2 names for prefix 'Mag', got %d: %v", len(names), names)
	}
}

func TestGetPlayerNames_PrefixVi(t *testing.T) {
	db := openTestDB(t)
	seedPlayerNamesGames(t, db)

	names, err := db.GetPlayerNames("Vi", 0)
	if err != nil {
		t.Fatalf("GetPlayerNames: %v", err)
	}
	if len(names) != 1 || names[0] != "Viswanathan Anand" {
		t.Errorf("expected [Viswanathan Anand], got %v", names)
	}
}

func TestGetPlayerNames_CaseInsensitive(t *testing.T) {
	db := openTestDB(t)
	seedPlayerNamesGames(t, db)

	names, err := db.GetPlayerNames("mag", 0)
	if err != nil {
		t.Fatalf("GetPlayerNames: %v", err)
	}
	if len(names) != 2 {
		t.Errorf("expected 2 names for lowercase prefix 'mag', got %d: %v", len(names), names)
	}
}

func TestGetPlayerNames_Limit(t *testing.T) {
	db := openTestDB(t)
	seedPlayerNamesGames(t, db)

	names, err := db.GetPlayerNames("Mag", 1)
	if err != nil {
		t.Fatalf("GetPlayerNames: %v", err)
	}
	if len(names) != 1 {
		t.Errorf("expected exactly 1 name with limit=1, got %d: %v", len(names), names)
	}
}


// mockMDB is a test double for MasterDB.
type mockMDB struct {
	// stats maps FEN → slice of move stats to return
	stats map[string][]masterdb.MoveStat
}

func (m *mockMDB) GetPositionStats(fen string) ([]masterdb.MoveStat, error) {
	if s, ok := m.stats[fen]; ok {
		return s, nil
	}
	return nil, nil
}

func TestGetDeviationPositions_NilMasterDB(t *testing.T) {
	db := openTestDB(t)
	rows, err := GetDeviationPositions(db, nil, []string{"Magnus Carlsen"}, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rows != nil {
		t.Errorf("expected nil result for nil mdb, got %v", rows)
	}
}

func TestGetDeviationPositions_NoDeviations(t *testing.T) {
	db := openTestDB(t)

	// 1. e4 e5 — seed a simple game with Magnus as white
	inp := game.GameInput{
		White: "Magnus Carlsen", Black: "Opponent", Result: "1-0",
		Source: "lichess", SourceID: "dev-test-nodevia",
		PGN: "[White \"Magnus Carlsen\"]\n[Black \"Opponent\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0",
	}
	if _, err := db.SaveGame(inp); err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	// Mock returns stats that INCLUDE the player's moves → no deviation.
	// Starting FEN after no moves = standard start.
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	fenAfterE4 := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	fenAfterE4E5 := "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"

	mdb := &mockMDB{
		stats: map[string][]masterdb.MoveStat{
			startFEN: {
				{MoveSAN: "e4", WhiteWins: 400, Draws: 200, BlackWins: 300, Total: 900},
				{MoveSAN: "d4", WhiteWins: 350, Draws: 180, BlackWins: 270, Total: 800},
			},
			fenAfterE4: {
				{MoveSAN: "e5", WhiteWins: 300, Draws: 150, BlackWins: 250, Total: 700},
				{MoveSAN: "c5", WhiteWins: 280, Draws: 140, BlackWins: 230, Total: 650},
			},
			fenAfterE4E5: {
				{MoveSAN: "Nf3", WhiteWins: 300, Draws: 130, BlackWins: 220, Total: 650},
			},
		},
	}

	result, err := GetDeviationPositions(db, mdb, []string{"Magnus Carlsen"}, 10)
	if err != nil {
		t.Fatalf("GetDeviationPositions: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected 0 deviations (moves all in theory), got %d", len(result))
	}
}

func TestGetDeviationPositions_WithDeviation(t *testing.T) {
	db := openTestDB(t)

	// Seed a game where Magnus plays 1. a4 as white — a rare deviation from theory.
	inp := game.GameInput{
		White: "Magnus Carlsen", Black: "Opponent", Result: "1-0",
		Source: "lichess", SourceID: "dev-test-devia",
		PGN: "[White \"Magnus Carlsen\"]\n[Black \"Opponent\"]\n[Result \"1-0\"]\n\n1. a4 e5 2. a5 Nf6 1-0",
	}
	if _, err := db.SaveGame(inp); err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	// The starting FEN — theory says e4/d4/c4 are top moves, not a4.
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	mdb := &mockMDB{
		stats: map[string][]masterdb.MoveStat{
			startFEN: {
				{MoveSAN: "e4", WhiteWins: 400, Draws: 200, BlackWins: 300, Total: 900},
				{MoveSAN: "d4", WhiteWins: 350, Draws: 180, BlackWins: 270, Total: 800},
				{MoveSAN: "c4", WhiteWins: 200, Draws: 100, BlackWins: 150, Total: 450},
				// "a4" not listed — clear deviation
			},
		},
	}

	result, err := GetDeviationPositions(db, mdb, []string{"Magnus Carlsen"}, 10)
	if err != nil {
		t.Fatalf("GetDeviationPositions: %v", err)
	}
	if len(result) == 0 {
		t.Fatal("expected at least one deviation row, got 0")
	}
	row := result[0]
	if row.FEN != startFEN {
		t.Errorf("expected deviation FEN %q, got %q", startFEN, row.FEN)
	}
	if row.PlayerMove != "a4" {
		t.Errorf("expected PlayerMove 'a4', got %q", row.PlayerMove)
	}
	if row.Count < 1 {
		t.Errorf("expected Count >= 1, got %d", row.Count)
	}
	if len(row.TheoryMoves) == 0 {
		t.Errorf("expected theory moves to be populated")
	}
}

func TestGetDeviationPositions_PlayerAsBlack(t *testing.T) {
	db := openTestDB(t)

	// Seed a game where Magnus is black and plays 1...a5 — a rare deviation.
	inp := game.GameInput{
		White: "SomeOpponent", Black: "Magnus Carlsen", Result: "0-1",
		Source: "lichess", SourceID: "dev-test-black",
		PGN: "[White \"SomeOpponent\"]\n[Black \"Magnus Carlsen\"]\n[Result \"0-1\"]\n\n1. e4 a5 0-1",
	}
	if _, err := db.SaveGame(inp); err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	// After 1. e4 the FEN is the position where black must move.
	fenAfterE4 := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	mdb := &mockMDB{
		stats: map[string][]masterdb.MoveStat{
			fenAfterE4: {
				{MoveSAN: "e5", WhiteWins: 300, Draws: 150, BlackWins: 250, Total: 700},
				{MoveSAN: "c5", WhiteWins: 280, Draws: 140, BlackWins: 230, Total: 650},
				{MoveSAN: "e6", WhiteWins: 200, Draws: 100, BlackWins: 150, Total: 450},
				// "a5" not listed — clear deviation
			},
		},
	}

	result, err := GetDeviationPositions(db, mdb, []string{"Magnus Carlsen"}, 10)
	if err != nil {
		t.Fatalf("GetDeviationPositions: %v", err)
	}
	if len(result) == 0 {
		t.Fatal("expected at least one deviation row for player-as-black, got 0")
	}
	row := result[0]
	if row.FEN != fenAfterE4 {
		t.Errorf("expected deviation FEN %q, got %q", fenAfterE4, row.FEN)
	}
	if row.PlayerMove != "a5" {
		t.Errorf("expected PlayerMove 'a5', got %q", row.PlayerMove)
	}
	if row.Count < 1 {
		t.Errorf("expected Count >= 1, got %d", row.Count)
	}
}


const (
	initialFENRep = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterD4FEN    = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
)

func seedRepertoireWithD4(t *testing.T, db *DB) string {
	t.Helper()
	repID, err := db.CreateRepertoire("Test Rep", "white")
	if err != nil {
		t.Fatalf("CreateRepertoire: %v", err)
	}
	_, err = db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: repID,
		FromFEN:      initialFENRep,
		ToFEN:        afterD4FEN,
		MoveSAN:      "d4",
		MoveUCI:      "d2d4",
	})
	if err != nil {
		t.Fatalf("SaveRepertoireMove: %v", err)
	}
	return repID
}

func TestGetRepertoireDeviations_Basic(t *testing.T) {
	db := openTestDB(t)

	// Save a game starting 1. e4 (the sampleGame PGN starts 1. e4 e5).
	id, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}
	if err := db.IndexGame(id); err != nil {
		t.Fatalf("IndexGame: %v", err)
	}

	// Repertoire says play 1. d4 — but our game played 1. e4 → should be a deviation.
	seedRepertoireWithD4(t, db)

	var white string
	db.db.QueryRow(`SELECT white FROM games WHERE id = ?`, id).Scan(&white) //nolint:errcheck

	rows, err := db.GetRepertoireDeviations([]string{white}, 10)
	if err != nil {
		t.Fatalf("GetRepertoireDeviations: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("expected at least one deviation")
	}
	found := false
	for _, row := range rows {
		if row.PlayerMove == "e4" {
			found = true
			hasD4 := false
			for _, m := range row.RepertoireMoves {
				if m == "d4" {
					hasD4 = true
				}
			}
			if !hasD4 {
				t.Errorf("RepertoireMoves = %v, want to contain d4", row.RepertoireMoves)
			}
		}
	}
	if !found {
		t.Errorf("no deviation row with PlayerMove=e4; rows: %+v", rows)
	}
}

func TestGetRepertoireDeviations_EmptyPlayerNames(t *testing.T) {
	db := openTestDB(t)
	rows, err := db.GetRepertoireDeviations([]string{}, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected empty result for no player names, got %d rows", len(rows))
	}
}

func TestGetRepertoireDeviations_NoRepertoire(t *testing.T) {
	db := openTestDB(t)
	id, _ := db.SaveGame(sampleGame())
	db.IndexGame(id) //nolint:errcheck
	var white string
	db.db.QueryRow(`SELECT white FROM games WHERE id = ?`, id).Scan(&white) //nolint:errcheck

	// No repertoire moves in DB → no deviations possible.
	rows, err := db.GetRepertoireDeviations([]string{white}, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected empty result, got %d", len(rows))
	}
}

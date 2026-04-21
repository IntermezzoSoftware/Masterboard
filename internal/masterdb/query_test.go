package masterdb

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// seedDB creates a small test database with known games for query tests.
func seedDB(t *testing.T) *DB {
	t.Helper()
	dir := t.TempDir()
	pgnPath := filepath.Join(dir, "seed.pgn")
	pgnContent := `[Event "A"]
[White "Kasparov"]
[Black "Karpov"]
[Result "1-0"]
[WhiteElo "2851"]
[BlackElo "2780"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0

[Event "B"]
[White "Anand"]
[Black "Kramnik"]
[Result "1/2-1/2"]
[WhiteElo "2817"]
[BlackElo "2800"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 1/2-1/2

[Event "C"]
[White "Magnus"]
[Black "Caruana"]
[Result "0-1"]
[WhiteElo "2882"]
[BlackElo "2844"]

1. d4 Nf6 2. c4 e6 0-1

`
	if err := os.WriteFile(pgnPath, []byte(pgnContent), 0644); err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join(dir, "out.db")
	cfg := IndexConfig{
		OutputPath:    outPath,
		Replace:       true,
		SkipGameIndex: false,
		Workers:       1,
		BatchSize:     10,
		MaxPhase:      5,
	}
	if _, err := RunIndexer([]string{pgnPath}, cfg); err != nil {
		t.Fatalf("RunIndexer: %v", err)
	}

	db, err := OpenForQuery(outPath)
	if err != nil {
		t.Fatalf("OpenForQuery: %v", err)
	}
	if db == nil {
		t.Fatal("OpenForQuery returned nil — DB not created")
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestGetPositionStats_StartingPosition(t *testing.T) {
	db := seedDB(t)

	// Starting position: both e4 and d4 were played.
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	stats, err := db.GetPositionStats(startFEN)
	if err != nil {
		t.Fatalf("GetPositionStats: %v", err)
	}
	if len(stats) == 0 {
		t.Fatal("expected non-empty stats for starting position")
	}

	// First result should be e4 or d4 (both played once; sorted by total desc — tied).
	moves := make(map[string]MoveStat)
	for _, s := range stats {
		moves[s.MoveSAN] = s
	}
	if _, ok := moves["e4"]; !ok {
		t.Error("expected e4 in starting position stats")
	}
	if _, ok := moves["d4"]; !ok {
		t.Error("expected d4 in starting position stats")
	}

	// e4 was played in games A and B (2 times).
	e4 := moves["e4"]
	if e4.Total != 2 {
		t.Errorf("e4 total: want 2, got %d", e4.Total)
	}
	if e4.WhiteWins != 1 {
		t.Errorf("e4 whiteWins: want 1 (game A = 1-0), got %d", e4.WhiteWins)
	}
	if e4.Draws != 1 {
		t.Errorf("e4 draws: want 1 (game B = 1/2-1/2), got %d", e4.Draws)
	}

	// d4 was played in game C only.
	d4 := moves["d4"]
	if d4.Total != 1 {
		t.Errorf("d4 total: want 1, got %d", d4.Total)
	}
	if d4.BlackWins != 1 {
		t.Errorf("d4 blackWins: want 1 (game C = 0-1), got %d", d4.BlackWins)
	}
}

func TestGetPositionStats_AverageElo(t *testing.T) {
	db := seedDB(t)

	// After 1. e4 e5 2. Nf3 Nc6, two games diverge: Bb5 a6 and Bb5 Nf6.
	// The position before move 3 (Bb5) has been reached in both games A and B.
	// This FEN is the Ruy Lopez starting position after 1.e4 e5 2.Nf3 Nc6 3.Bb5
	// — but we want the position BEFORE Bb5, i.e. after 2...Nc6.
	// We test AvgElo is non-zero.
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	stats, err := db.GetPositionStats(startFEN)
	if err != nil {
		t.Fatalf("GetPositionStats: %v", err)
	}
	for _, s := range stats {
		if s.AvgElo == 0 && s.Total > 0 {
			t.Errorf("move %s: expected non-zero AvgElo (all test games have Elo)", s.MoveSAN)
		}
	}
}

func TestGetGamesAtPosition_ReturnsCorrectGames(t *testing.T) {
	db := seedDB(t)

	// Starting position: all 3 games passed through it; should return all 3.
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	games, err := db.GetGamesAtPosition(startFEN, 10)
	if err != nil {
		t.Fatalf("GetGamesAtPosition: %v", err)
	}
	if len(games) != 3 {
		t.Errorf("expected 3 games, got %d", len(games))
	}

	// Sorted by Elo desc: Magnus (2882+2844=5726) > Kasparov (2851+2780=5631) > Anand (2817+2800=5617).
	if games[0].White != "Magnus" {
		t.Errorf("expected Magnus first (highest Elo), got %s", games[0].White)
	}
}

func TestGetGamesAtPosition_Limit(t *testing.T) {
	db := seedDB(t)

	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	games, err := db.GetGamesAtPosition(startFEN, 2)
	if err != nil {
		t.Fatalf("GetGamesAtPosition: %v", err)
	}
	if len(games) != 2 {
		t.Errorf("expected 2 games (limited), got %d", len(games))
	}
}

func TestGetGamePGN(t *testing.T) {
	db := seedDB(t)

	// Get all game IDs.
	rows, err := db.sql.Query(`SELECT id, white FROM master_games ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type gameRow struct {
		id    int64
		white string
	}
	var gs []gameRow
	for rows.Next() {
		var g gameRow
		rows.Scan(&g.id, &g.white)
		gs = append(gs, g)
	}
	if len(gs) != 3 {
		t.Fatalf("expected 3 games, got %d", len(gs))
	}

	// Retrieve PGN for first game and check it contains expected content.
	pgn, err := db.GetGamePGN(gs[0].id)
	if err != nil {
		t.Fatalf("GetGamePGN: %v", err)
	}
	if pgn == "" {
		t.Error("expected non-empty PGN")
	}
	if gs[0].white == "Kasparov" {
		// Game A: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
		for _, want := range []string{"Kasparov", "Karpov", "e4", "Bb5", "1-0"} {
			if len(pgn) == 0 {
				break
			}
			found := false
			for i := 0; i <= len(pgn)-len(want); i++ {
				if pgn[i:i+len(want)] == want {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("expected %q in PGN:\n%s", want, pgn)
			}
		}
	}
}

func TestGameCount(t *testing.T) {
	db := seedDB(t)

	count, err := db.GameCount()
	if err != nil {
		t.Fatalf("GameCount: %v", err)
	}
	if count != 3 {
		t.Errorf("expected 3 games, got %d", count)
	}
}

func TestGetPositionStats_UnknownPosition(t *testing.T) {
	db := seedDB(t)

	// A position that was never reached in the test games.
	// FEN for position after 1.a4 — not present in any seed game.
	unknownFEN := "rnbqkbnr/pppppppp/8/8/P7/8/1PPPPPPP/RNBQKBNR b KQkq - 0 1"
	stats, err := db.GetPositionStats(unknownFEN)
	if err != nil {
		t.Fatalf("GetPositionStats: %v", err)
	}
	if len(stats) != 0 {
		t.Errorf("expected empty stats for unknown position, got %d rows", len(stats))
	}
}

func TestGetGamesAtPosition_AfterDeepMove(t *testing.T) {
	// Create a DB from a game deep enough to test the 50-ply depth cap.
	// Positions beyond ply 50 should NOT appear in the game index.
	dir := t.TempDir()
	pgnPath := filepath.Join(dir, "deep.pgn")

	// Construct a long game (51+ half-moves) that won't repeat positions.
	// Use a simple back-and-forth that avoids repetition via different move orders.
	pgnContent := `[Event "Long"]
[White "A"]
[Black "B"]
[Result "1/2-1/2"]
[WhiteElo "2500"]
[BlackElo "2500"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5
7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8
13. Nf1 Bf8 14. Ng3 g6 15. a4 c5 16. d5 c4 17. b4 Nb6 18. axb5 axb5
19. Rxa8 Bxa8 20. Bg5 h6 21. Be3 Qc7 22. Qd2 Kh7 23. Nh2 Ng8 24. Nhf1 Ne7
25. Ne2 Ng7 26. f3 f5 1/2-1/2

`
	if err := os.WriteFile(pgnPath, []byte(pgnContent), 0644); err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join(dir, "deep.db")
	cfg := IndexConfig{
		OutputPath:    outPath,
		Replace:       true,
		SkipGameIndex: false,
		Workers:       1,
		BatchSize:     10,
		MaxPhase:      5,
	}
	if _, err := RunIndexer([]string{pgnPath}, cfg); err != nil {
		t.Fatalf("RunIndexer: %v", err)
	}

	db, err := OpenForQuery(outPath)
	if err != nil {
		t.Fatal(err)
	}
	if db == nil {
		t.Fatal("OpenForQuery returned nil")
	}
	defer db.Close()

	// Verify only up to GameIndexMaxPly index rows were created.
	var indexCount int
	db.sql.QueryRow(`SELECT COUNT(*) FROM master_position_game_index`).Scan(&indexCount)
	if indexCount > GameIndexMaxPly {
		t.Errorf("expected at most %d index rows (depth cap), got %d", GameIndexMaxPly, indexCount)
	}
}

func TestGetPositionStats_SortedByTotal(t *testing.T) {
	db := seedDB(t)

	// The starting position has e4 (total=2) and d4 (total=1); e4 should come first.
	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	stats, err := db.GetPositionStats(startFEN)
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) < 2 {
		t.Fatalf("expected at least 2 moves, got %d", len(stats))
	}
	if stats[0].Total < stats[1].Total {
		t.Errorf("stats not sorted descending by total: [0].Total=%d < [1].Total=%d",
			stats[0].Total, stats[1].Total)
	}
}

func TestWriteBatch_WithContext(t *testing.T) {
	// Verifies that stats written to the split stats DB are visible via OpenForQuery (ATTACH).
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	mainDB, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	statsPath, _ := SplitDBPaths(dbPath)
	statsDB, err := openPartial(statsPath, schemaStats)
	if err != nil {
		mainDB.Close()
		t.Fatal(err)
	}

	ctx := context.Background()
	_, pos, _ := EncodeGame("1. e4 e5 1-0")
	hash := pos[0].Hash
	ml := newMoveLookup()
	moveID := ml.getOrAdd("e4")
	stats := map[statsKey]statRow{
		{hash: hash, moveID: moveID}: {WhiteWins: 5, Draws: 3, BlackWins: 2, TotalElo: 5000, EloCount: 10},
	}
	if err := statsDB.writeStats(ctx, stats, nil); err != nil {
		statsDB.Close(); mainDB.Close()
		t.Fatalf("WriteStats: %v", err)
	}
	// Write the move lookup so the JOIN in GetPositionStats can resolve move IDs.
	if err := mainDB.writeMoveLookup(ctx, ml); err != nil {
		statsDB.Close(); mainDB.Close()
		t.Fatalf("WriteMoveLookup: %v", err)
	}

	// Finalize both DBs so OpenForQuery can open them in WAL mode.
	if err := mainDB.finalize(); err != nil {
		statsDB.Close(); mainDB.Close()
		t.Fatalf("Finalize main: %v", err)
	}
	if err := statsDB.finalize(); err != nil {
		statsDB.Close(); mainDB.Close()
		t.Fatalf("Finalize stats: %v", err)
	}
	statsDB.Close()
	mainDB.Close()

	// OpenForQuery detects the split file and ATTACHes it.
	qdb, err := OpenForQuery(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer qdb.Close()

	moves, err := qdb.GetPositionStats("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 1 || moves[0].MoveSAN != "e4" {
		t.Errorf("expected e4, got %v", moves)
	}
	if moves[0].WhiteWins != 5 || moves[0].Draws != 3 || moves[0].BlackWins != 2 {
		t.Errorf("wrong results: %+v", moves[0])
	}
	if moves[0].AvgElo != 500 {
		t.Errorf("AvgElo: want 500, got %d", moves[0].AvgElo)
	}
}

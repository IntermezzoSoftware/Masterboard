package masterdb

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteBatch_BasicInsert(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	blob1, _, err := EncodeGame("1. e4 e5 1-0")
	if err != nil {
		t.Fatal(err)
	}
	games := []encodedGame{{
		ParsedGame: ParsedGame{
			White: "Smith", Black: "Jones", Result: "1-0", Date: "2024.01.01", ECO: "B20",
			EloWhite: 2000, EloBlack: 1900,
		},
		MovesBlob: blob1,
	}}

	var ids []int64
	ctx := context.Background()
	if err := db.writeBatch(ctx, games, &ids); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}
	if len(ids) != 1 {
		t.Fatalf("expected 1 game ID, got %d", len(ids))
	}

	count, err := db.GameCount()
	if err != nil {
		t.Fatalf("GameCount: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 game, got %d", count)
	}
}

func TestWriteBatch_StatsUpsert(t *testing.T) {
	// Stats live in the split stats DB, not the main DB.
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	statsPath, _ := SplitDBPaths(path)
	statsDB, err := openPartial(statsPath, schemaStats)
	if err != nil {
		t.Fatalf("openPartial stats: %v", err)
	}
	defer statsDB.Close()

	_, pos, err := EncodeGame("1. e4 e5 1-0")
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	ml := newMoveLookup()
	moveID := ml.getOrAdd(pos[0].MoveSAN)
	hash := pos[0].Hash
	key := statsKey{hash: hash, moveID: moveID}

	// First batch: 2 white wins.
	if err := statsDB.writeStats(ctx, map[statsKey]statRow{key: {WhiteWins: 2}}, nil); err != nil {
		t.Fatalf("batch 1: %v", err)
	}

	// Second batch: 1 more white win + 1 draw.
	if err := statsDB.writeStats(ctx, map[statsKey]statRow{key: {WhiteWins: 1, Draws: 1}}, nil); err != nil {
		t.Fatalf("batch 2: %v", err)
	}

	// Query the stats directly from the split stats DB.
	var wins, draws, losses int
	err = statsDB.sql.QueryRow(
		`SELECT wins, draws, losses FROM master_position_stats WHERE position_hash = ? AND move_id = ?`,
		hash, moveID,
	).Scan(&wins, &draws, &losses)
	if err != nil {
		t.Fatalf("query stats: %v", err)
	}
	if wins != 3 || draws != 1 || losses != 0 {
		t.Errorf("expected wins=3, draws=1, losses=0; got wins=%d, draws=%d, losses=%d",
			wins, draws, losses)
	}
}

func TestWriteGameIndex(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	// Main DB: games table.
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Split index DB.
	_, indexPath := SplitDBPaths(path)
	indexDB, err := openPartial(indexPath, schemaIndex)
	if err != nil {
		t.Fatalf("openPartial index: %v", err)
	}
	defer indexDB.Close()

	// Insert a game first to get a valid game_id.
	blob, pos, err := EncodeGame("1. d4 Nf6 1-0")
	if err != nil {
		t.Fatal(err)
	}
	games := []encodedGame{{
		ParsedGame: ParsedGame{White: "A", Black: "B", Result: "1-0"},
		MovesBlob:  blob,
	}}
	var ids []int64
	ctx := context.Background()
	if err := db.writeBatch(ctx, games, &ids); err != nil {
		t.Fatal(err)
	}

	gameID := ids[0]
	hash := pos[0].Hash
	rows := []indexRow{{posHash: hash, gameID: gameID}}

	if err := indexDB.writeGameIndex(ctx, rows, nil); err != nil {
		t.Fatalf("WriteGameIndex: %v", err)
	}

	// Verify the row was inserted.
	var count int
	err = indexDB.sql.QueryRow(
		`SELECT COUNT(*) FROM master_position_game_index WHERE game_id = ?`, gameID,
	).Scan(&count)
	if err != nil {
		t.Fatalf("query index: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 index row, got %d", count)
	}
}

func TestRunIndexer_SmallFile(t *testing.T) {
	// Write a small PGN to a temp file and run the indexer on it.
	dir := t.TempDir()
	pgnPath := filepath.Join(dir, "test.pgn")
	pgnContent := `[Event "A"]
[White "X"]
[Black "Y"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0

[Event "B"]
[White "P"]
[Black "Q"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1

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

	result, err := RunIndexer([]string{pgnPath}, cfg)
	if err != nil {
		t.Fatalf("RunIndexer: %v", err)
	}
	if result.GamesIndexed != 2 {
		t.Errorf("expected 2 games indexed, got %d", result.GamesIndexed)
	}
	if result.StatsRows == 0 {
		t.Error("expected non-zero stats rows")
	}
	if result.IndexRows == 0 {
		t.Error("expected non-zero index rows")
	}
}

func TestWriteStatsDirect(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	// Stats live in the split stats DB.
	statsPath, _ := SplitDBPaths(path)
	db, err := openPartial(statsPath, schemaStats)
	if err != nil {
		t.Fatalf("openPartial stats: %v", err)
	}
	defer db.Close()

	_, pos, err := EncodeGame("1. e4 e5 1-0")
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	ml := newMoveLookup()
	moveID := ml.getOrAdd(pos[0].MoveSAN)
	hash := pos[0].Hash

	stats := map[statsKey]statRow{
		{hash: hash, moveID: moveID}: {WhiteWins: 3, Draws: 1, TotalElo: 6000, EloCount: 3},
	}

	if err := db.writeStatsDirect(ctx, stats, nil); err != nil {
		t.Fatalf("WriteStatsDirect: %v", err)
	}

	var wins, draws, losses, totalElo, eloCount int
	err = db.sql.QueryRow(
		`SELECT wins, draws, losses, total_elo, elo_count FROM master_position_stats WHERE position_hash = ? AND move_id = ?`,
		hash, moveID,
	).Scan(&wins, &draws, &losses, &totalElo, &eloCount)
	if err != nil {
		t.Fatalf("query stats: %v", err)
	}
	if wins != 3 || draws != 1 || losses != 0 || totalElo != 6000 || eloCount != 3 {
		t.Errorf("got wins=%d draws=%d losses=%d totalElo=%d eloCount=%d", wins, draws, losses, totalElo, eloCount)
	}
}

func TestGameFingerprint_Dedup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	blob, _, err := EncodeGame("1. e4 e5 1-0")
	if err != nil {
		t.Fatal(err)
	}

	game := encodedGame{
		ParsedGame: ParsedGame{
			White: "Smith", Black: "Jones", Result: "1-0", Date: "2024.01.01",
			EloWhite: 2000, EloBlack: 1900,
		},
		MovesBlob: blob,
	}

	ctx := context.Background()

	// Insert the same game twice.
	var ids1 []int64
	if err := db.writeBatch(ctx, []encodedGame{game}, &ids1); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if len(ids1) != 1 {
		t.Fatalf("expected 1 ID from first insert, got %d", len(ids1))
	}

	var ids2 []int64
	if err := db.writeBatch(ctx, []encodedGame{game}, &ids2); err != nil {
		t.Fatalf("second insert: %v", err)
	}
	// INSERT OR IGNORE skips the duplicate — no ID returned.
	if len(ids2) != 0 {
		t.Errorf("expected 0 IDs from duplicate insert, got %d", len(ids2))
	}

	count, err := db.GameCount()
	if err != nil {
		t.Fatalf("GameCount: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 game after dedup, got %d", count)
	}
}

func TestGameFingerprint_Different(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	blob1, _, err := EncodeGame("1. e4 e5 1-0")
	if err != nil {
		t.Fatal(err)
	}
	blob2, _, err := EncodeGame("1. d4 d5 0-1")
	if err != nil {
		t.Fatal(err)
	}

	games := []encodedGame{
		{ParsedGame: ParsedGame{White: "A", Black: "B", Result: "1-0", Date: "2024.01.01"}, MovesBlob: blob1},
		{ParsedGame: ParsedGame{White: "C", Black: "D", Result: "0-1", Date: "2024.02.01"}, MovesBlob: blob2},
	}

	ctx := context.Background()
	var ids []int64
	if err := db.writeBatch(ctx, games, &ids); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}
	if len(ids) != 2 {
		t.Errorf("expected 2 IDs, got %d", len(ids))
	}

	count, err := db.GameCount()
	if err != nil {
		t.Fatalf("GameCount: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 games, got %d", count)
	}
}

func TestLoadMoveLookup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	ml := newMoveLookup()
	ml.getOrAdd("e4")
	ml.getOrAdd("d4")
	ml.getOrAdd("Nf3")

	if err := db.writeMoveLookup(ctx, ml); err != nil {
		t.Fatalf("WriteMoveLookup: %v", err)
	}

	loaded, err := db.loadMoveLookup()
	if err != nil {
		t.Fatalf("LoadMoveLookup: %v", err)
	}
	if loaded.count() != 3 {
		t.Errorf("expected 3 moves, got %d", loaded.count())
	}
	// Verify same IDs.
	for _, san := range []string{"e4", "d4", "Nf3"} {
		origID := ml.getOrAdd(san)
		loadedID := loaded.getOrAdd(san)
		if origID != loadedID {
			t.Errorf("move %q: original ID %d != loaded ID %d", san, origID, loadedID)
		}
	}
}

func TestMaxGameID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Empty database.
	maxID, err := db.maxGameID()
	if err != nil {
		t.Fatalf("MaxGameID empty: %v", err)
	}
	if maxID != 0 {
		t.Errorf("expected 0 for empty db, got %d", maxID)
	}

	// Insert a game.
	blob, _, err := EncodeGame("1. e4 e5 1-0")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	games := []encodedGame{{
		ParsedGame: ParsedGame{White: "A", Black: "B", Result: "1-0"},
		MovesBlob:  blob,
	}}
	if err := db.writeBatch(ctx, games, nil); err != nil {
		t.Fatal(err)
	}

	maxID, err = db.maxGameID()
	if err != nil {
		t.Fatalf("MaxGameID: %v", err)
	}
	if maxID != 1 {
		t.Errorf("expected max ID 1, got %d", maxID)
	}
}

func TestOpenForQuery_NotExist(t *testing.T) {
	dir := t.TempDir()
	mdb, err := OpenForQuery(filepath.Join(dir, "nonexistent.db"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mdb != nil {
		t.Error("expected nil for nonexistent path")
	}
}

func TestWriteImportLog_AndGetSummary(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	entries := []importLogEntry{
		{Filename: "games2024.pgn", SizeBytes: 1024000, GamesImported: 2000, ImportDate: "2026-04-06T12:00:00Z"},
		{Filename: "games2025.pgn", SizeBytes: 512000, GamesImported: 1000, ImportDate: "2026-04-07T10:00:00Z"},
	}
	if err := db.writeImportLog(entries); err != nil {
		t.Fatalf("WriteImportLog: %v", err)
	}

	s, err := db.GetImportSummary()
	if err != nil {
		t.Fatalf("GetImportSummary: %v", err)
	}
	if s.TotalGames != 3000 {
		t.Errorf("TotalGames: got %d, want 3000", s.TotalGames)
	}
	if s.FileCount != 2 {
		t.Errorf("FileCount: got %d, want 2", s.FileCount)
	}
	if s.LastImport != "2026-04-07T10:00:00Z" {
		t.Errorf("LastImport: got %q, want 2026-04-07T10:00:00Z", s.LastImport)
	}
	if len(s.Filenames) != 2 {
		t.Fatalf("Filenames: got %d entries, want 2", len(s.Filenames))
	}
	if s.Filenames[0] != "games2024.pgn" || s.Filenames[1] != "games2025.pgn" {
		t.Errorf("Filenames order: got %v", s.Filenames)
	}
}

func TestGetImportSummary_Empty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	s, err := db.GetImportSummary()
	if err != nil {
		t.Fatalf("GetImportSummary on empty: %v", err)
	}
	if s.TotalGames != 0 || s.FileCount != 0 {
		t.Errorf("expected zeros, got TotalGames=%d FileCount=%d", s.TotalGames, s.FileCount)
	}
	if len(s.Filenames) != 0 {
		t.Errorf("expected empty Filenames, got %v", s.Filenames)
	}
}

func TestRunIndexer_Append(t *testing.T) {
	dir := t.TempDir()

	// Create two PGN files with some overlapping games.
	pgn1 := filepath.Join(dir, "file1.pgn")
	pgn1Content := `[Event "A"]
[White "X"]
[Black "Y"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0

[Event "B"]
[White "P"]
[Black "Q"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1

`
	if err := os.WriteFile(pgn1, []byte(pgn1Content), 0644); err != nil {
		t.Fatal(err)
	}

	pgn2 := filepath.Join(dir, "file2.pgn")
	pgn2Content := `[Event "C"]
[White "M"]
[Black "N"]
[Result "1/2-1/2"]

1. c4 e5 2. Nc3 Nf6 1/2-1/2

[Event "A"]
[White "X"]
[Black "Y"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0

`
	if err := os.WriteFile(pgn2, []byte(pgn2Content), 0644); err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join(dir, "out.db")

	cfg1 := IndexConfig{
		OutputPath:    outPath,
		Replace:       true,
		SkipGameIndex: false,
		Workers:       1,
		BatchSize:     10,
	}
	result1, err := RunIndexer([]string{pgn1}, cfg1)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	if result1.GamesIndexed != 2 {
		t.Fatalf("first import: expected 2 games, got %d", result1.GamesIndexed)
	}

	cfg2 := IndexConfig{
		OutputPath:    outPath,
		Replace:       false,
		SkipGameIndex: false,
		Workers:       1,
		BatchSize:     10,
	}
	result2, err := RunIndexer([]string{pgn2}, cfg2)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	// Only 1 new game should be indexed (the duplicate is skipped).
	if result2.GamesIndexed != 1 {
		t.Errorf("second import: expected 1 new game, got %d", result2.GamesIndexed)
	}

	// Verify total game count via main DB.
	mainDB, err := Open(outPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer mainDB.Close()

	count, err := mainDB.GameCount()
	if err != nil {
		t.Fatalf("GameCount: %v", err)
	}
	if count != 3 {
		t.Errorf("expected 3 total games, got %d", count)
	}

	// Verify stats include data from all three unique games.
	// Stats live in the split stats DB.
	statsPath, _ := SplitDBPaths(outPath)
	statsDB, err := openPartial(statsPath, schemaStats)
	if err != nil {
		t.Fatalf("open stats db: %v", err)
	}
	defer statsDB.Close()

	var statCount int
	err = statsDB.sql.QueryRow(`SELECT COUNT(*) FROM master_position_stats`).Scan(&statCount)
	if err != nil {
		t.Fatalf("count stats: %v", err)
	}
	if statCount == 0 {
		t.Error("expected non-zero stats rows")
	}
}

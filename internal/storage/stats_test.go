package storage

import (
	"encoding/json"
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

func seedStatsGames(t *testing.T, db *DB) {
	t.Helper()
	games := []game.GameInput{
		{
			White: "Magnus", Black: "Hikaru", Result: "1-0",
			ECO: "C65", Opening: "Ruy Lopez, Berlin Defense", TimeControl: "600+0",
			Source: "lichess", SourceID: "tc-test-1",
			// PGN reaches the Berlin Defense (C65) position so ClassifyGame stores ECO correctly.
			PGN: "[White \"Magnus\"]\n[Black \"Hikaru\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 1-0",
		},
		{
			White: "Hikaru", Black: "Magnus", Result: "0-1",
			ECO: "D20", Opening: "Queen's Gambit", TimeControl: "600+0",
			Source: "lichess", SourceID: "tc-test-2",
			PGN: "[White \"Hikaru\"]\n[Black \"Magnus\"]\n[Result \"0-1\"]\n\n1. d4 d5 0-1",
		},
		{
			White: "Magnus", Black: "Anish", Result: "1/2-1/2",
			ECO: "C65", Opening: "Ruy Lopez, Berlin Defense", TimeControl: "180+2",
			Source: "lichess", SourceID: "tc-test-3",
			// PGN reaches the Berlin Defense (C65) position so ClassifyGame stores ECO correctly.
			PGN: "[White \"Magnus\"]\n[Black \"Anish\"]\n[Result \"1/2-1/2\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 1/2-1/2",
		},
		{
			White: "Anish", Black: "Magnus", Result: "1-0",
			ECO: "A40", Opening: "Modern Defense", TimeControl: "60+1",
			Source: "lichess", SourceID: "tc-test-4",
			PGN: "[White \"Anish\"]\n[Black \"Magnus\"]\n[Result \"1-0\"]\n\n1. d4 g6 1-0",
		},
	}
	for _, g := range games {
		if _, err := db.SaveGame(g); err != nil {
			t.Fatalf("seed game: %v", err)
		}
	}
}

func TestGetPlayerStats_ColourResults(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	stats, err := db.GetPlayerStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerStats: %v", err)
	}

	// As White (2 games): 1 win (vs Hikaru), 1 draw (vs Anish)
	if stats.AsWhite.Wins != 1 {
		t.Errorf("AsWhite.Wins = %d, want 1", stats.AsWhite.Wins)
	}
	if stats.AsWhite.Draws != 1 {
		t.Errorf("AsWhite.Draws = %d, want 1", stats.AsWhite.Draws)
	}
	if stats.AsWhite.Losses != 0 {
		t.Errorf("AsWhite.Losses = %d, want 0", stats.AsWhite.Losses)
	}
	if stats.AsWhite.Total != 2 {
		t.Errorf("AsWhite.Total = %d, want 2", stats.AsWhite.Total)
	}

	// As Black (2 games): 1 win (vs Hikaru — result 0-1), 1 loss (vs Anish — result 1-0)
	if stats.AsBlack.Wins != 1 {
		t.Errorf("AsBlack.Wins = %d, want 1", stats.AsBlack.Wins)
	}
	if stats.AsBlack.Losses != 1 {
		t.Errorf("AsBlack.Losses = %d, want 1", stats.AsBlack.Losses)
	}
	if stats.AsBlack.Total != 2 {
		t.Errorf("AsBlack.Total = %d, want 2", stats.AsBlack.Total)
	}

	if stats.TotalGames != 4 {
		t.Errorf("TotalGames = %d, want 4", stats.TotalGames)
	}
}

func TestGetPlayerStats_ByTimeControl(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	stats, err := db.GetPlayerStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerStats: %v", err)
	}

	tcMap := make(map[string]TimeControlResults)
	for _, tc := range stats.ByTimeControl {
		tcMap[tc.Category] = tc
	}
	if tcMap["rapid"].Results.Total != 2 {
		t.Errorf("rapid total = %d, want 2", tcMap["rapid"].Results.Total)
	}
	if tcMap["blitz"].Results.Total != 1 {
		t.Errorf("blitz total = %d, want 1", tcMap["blitz"].Results.Total)
	}
	if tcMap["bullet"].Results.Total != 1 {
		t.Errorf("bullet total = %d, want 1", tcMap["bullet"].Results.Total)
	}
}

func TestGetPlayerStats_ByOpening(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	stats, err := db.GetPlayerStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerStats: %v", err)
	}

	// C65 Spanish Game: Magnus played it as White in 2 games (1 win, 1 draw)
	found := false
	for _, row := range stats.ByOpening {
		if row.ECO == "C65" {
			found = true
			if row.Games != 2 {
				t.Errorf("C65 Games = %d, want 2", row.Games)
			}
		}
	}
	if !found {
		t.Error("C65 not found in ByOpening")
	}
}

func TestGetPlayerStats_NoIdentity(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	// Empty PlayerNames = all games
	stats, err := db.GetPlayerStats(StatsFilters{})
	if err != nil {
		t.Fatalf("GetPlayerStats: %v", err)
	}
	if stats.TotalGames != 4 {
		t.Errorf("TotalGames = %d, want 4", stats.TotalGames)
	}
}


func seedAnalysisData(t *testing.T, db *DB, gameID string) {
	t.Helper()
	nagBlunder := 4
	nagMistake := 2
	// Game: Anish (white) vs Magnus (black).
	// Ply 1 = white move (Anish, fine), ply 2 = black move (Magnus blunder),
	// ply 3 = white move (Anish, fine — unpunished), ply 4 = black move (Magnus mistake),
	// ply 5 = white move (Anish, fine).
	evals := []analysisEval{
		{Ply: 1, Accuracy: 85.0, Nag: nil},
		{Ply: 2, Accuracy: 30.0, Nag: &nagBlunder},
		{Ply: 3, Accuracy: 70.0, Nag: nil},
		{Ply: 4, Accuracy: 45.0, Nag: &nagMistake},
		{Ply: 5, Accuracy: 92.0, Nag: nil},
	}
	evalsJSON, _ := json.Marshal(evals)
	whiteAcc := 82.5
	blackAcc := 37.5
	_, err := db.db.Exec(`INSERT INTO game_analyses
		(game_id, depth, status, white_accuracy, black_accuracy, white_acpl, black_acpl,
		 evals, analysed_at, created_at, updated_at)
		VALUES (?, 22, 'complete', ?, ?, 25.0, 80.0, ?, '2024-01-01T12:00:00Z',
		        '2024-01-01T12:00:00Z', '2024-01-01T12:00:00Z')`,
		gameID, whiteAcc, blackAcc, string(evalsJSON))
	if err != nil {
		t.Fatalf("seed analysis: %v", err)
	}
}

// analysisEval mirrors analysis.MoveEval for test marshalling without importing the package.
type analysisEval struct {
	Ply      int     `json:"ply"`
	Accuracy float64 `json:"accuracy"`
	Nag      *int    `json:"nag"`
}

func findGameID(t *testing.T, db *DB, white, black string) string {
	t.Helper()
	var id string
	row := db.db.QueryRow(`SELECT id FROM games WHERE white = ? AND black = ?`, white, black)
	if err := row.Scan(&id); err != nil {
		t.Fatalf("findGameID(%q, %q): %v", white, black, err)
	}
	return id
}

func TestGetPlayerAnalysisStats_AccuracyTimeSeries(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	gameID := findGameID(t, db, "Anish", "Magnus")
	seedAnalysisData(t, db, gameID)

	stats, err := db.GetPlayerAnalysisStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerAnalysisStats: %v", err)
	}

	if len(stats.AccuracyTimeSeries) != 1 {
		t.Fatalf("AccuracyTimeSeries len = %d, want 1", len(stats.AccuracyTimeSeries))
	}
	pt := stats.AccuracyTimeSeries[0]
	if pt.PlayerSide != "black" {
		t.Errorf("PlayerSide = %q, want %q", pt.PlayerSide, "black")
	}
	if pt.PlayerAcc < 37 || pt.PlayerAcc > 38 {
		t.Errorf("PlayerAcc = %.1f, want ~37.5", pt.PlayerAcc)
	}
}

func TestGetPlayerAnalysisStats_LuckOpportunism(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	gameID := findGameID(t, db, "Anish", "Magnus")
	seedAnalysisData(t, db, gameID)

	stats, err := db.GetPlayerAnalysisStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerAnalysisStats: %v", err)
	}

	ls := stats.LuckStats
	// Magnus (black): blunder at ply 2 + mistake at ply 4 = 2 bad moves.
	if ls.BlunderCount != 2 {
		t.Errorf("BlunderCount = %d, want 2", ls.BlunderCount)
	}
	// After ply 2 blunder, ply 3 (Anish) had Nag=nil → unpunished.
	// After ply 4 mistake, ply 5 (Anish) had Nag=nil → unpunished.
	if ls.UnpunishedBlunders != 2 {
		t.Errorf("UnpunishedBlunders = %d, want 2", ls.UnpunishedBlunders)
	}
	// Anish (white) had no blunders.
	if ls.OppBlunderCount != 0 {
		t.Errorf("OppBlunderCount = %d, want 0", ls.OppBlunderCount)
	}
}

func TestGetPlayerStats_ExcludeFolder(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	// Move the Magnus vs Hikaru game (result 0-1, Magnus wins as black) into a folder.
	folderID, err := db.CreateFolder("Study", nil)
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	gameID := findGameID(t, db, "Hikaru", "Magnus")
	if err := db.MoveGameToFolder(gameID, &folderID); err != nil {
		t.Fatalf("MoveGameToFolder: %v", err)
	}

	// Without exclusion: Magnus has 4 games, 2 wins.
	base, err := db.GetPlayerStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerStats: %v", err)
	}
	if base.TotalGames != 4 {
		t.Fatalf("baseline TotalGames = %d, want 4", base.TotalGames)
	}

	// With exclusion: the Hikaru-Magnus game is gone — 3 games, 1 fewer win.
	filtered, err := db.GetPlayerStats(StatsFilters{
		PlayerNames:      []string{"magnus"},
		ExcludeFolderIDs: []string{folderID},
	})
	if err != nil {
		t.Fatalf("GetPlayerStats with exclude: %v", err)
	}
	if filtered.TotalGames != 3 {
		t.Errorf("filtered TotalGames = %d, want 3", filtered.TotalGames)
	}
	// Magnus as black: was 1W+1L; now just 1L (the 0-1 win is excluded).
	if filtered.AsBlack.Wins != 0 {
		t.Errorf("AsBlack.Wins = %d, want 0 after folder exclusion", filtered.AsBlack.Wins)
	}
}

func TestGetPlayerStats_ExcludeCollection(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	collID, err := db.CreateCollection("Instructional")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	// Tag both of Magnus's white games (Magnus-Hikaru and Magnus-Anish).
	for _, players := range [][2]string{{"Magnus", "Hikaru"}, {"Magnus", "Anish"}} {
		gid := findGameID(t, db, players[0], players[1])
		if err := db.AddGameToCollection(gid, collID); err != nil {
			t.Fatalf("AddGameToCollection: %v", err)
		}
	}

	filtered, err := db.GetPlayerStats(StatsFilters{
		PlayerNames:          []string{"magnus"},
		ExcludeCollectionIDs: []string{collID},
	})
	if err != nil {
		t.Fatalf("GetPlayerStats with exclude: %v", err)
	}
	// 2 white games excluded → 2 games remain (both black games).
	if filtered.TotalGames != 2 {
		t.Errorf("filtered TotalGames = %d, want 2", filtered.TotalGames)
	}
	if filtered.AsWhite.Total != 0 {
		t.Errorf("AsWhite.Total = %d, want 0 after collection exclusion", filtered.AsWhite.Total)
	}
}

func TestGetPlayerAnalysisStats_NoAnalysis(t *testing.T) {
	db := openTestDB(t)
	seedStatsGames(t, db)

	// No analysis data → should return empty result, not error.
	stats, err := db.GetPlayerAnalysisStats(StatsFilters{PlayerNames: []string{"magnus"}})
	if err != nil {
		t.Fatalf("GetPlayerAnalysisStats: %v", err)
	}
	if len(stats.AccuracyTimeSeries) != 0 {
		t.Errorf("expected empty AccuracyTimeSeries, got %d points", len(stats.AccuracyTimeSeries))
	}
}

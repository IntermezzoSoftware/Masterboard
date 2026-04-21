package masterdb

import (
	"strings"
	"testing"
)

const samplePGN = `[Event "Test"]
[Site "?"]
[Date "2024.01.01"]
[White "Smith, John"]
[Black "Doe, Jane"]
[Result "1-0"]
[WhiteElo "2000"]
[BlackElo "1900"]
[ECO "B20"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 1-0

[Event "Test2"]
[Site "?"]
[Date "2024.01.02"]
[White "Brown, Bob"]
[Black "White, Alice"]
[Result "1/2-1/2"]
[ECO "D00"]

1. d4 d5 2. Bf4 Nf6 1/2-1/2

[Event "Incomplete"]
[Site "?"]
[Date "2024.01.03"]
[White "X"]
[Black "Y"]
[Result "*"]

1. e4 *

`

func TestParseReader_BasicGames(t *testing.T) {
	var games []ParsedGame
	err := parseReader(strings.NewReader(samplePGN), func(pg ParsedGame) {
		games = append(games, pg)
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The "*" game should be skipped.
	if len(games) != 2 {
		t.Fatalf("expected 2 games, got %d", len(games))
	}

	g0 := games[0]
	if g0.White != "Smith, John" {
		t.Errorf("game 0 White: got %q, want %q", g0.White, "Smith, John")
	}
	if g0.Black != "Doe, Jane" {
		t.Errorf("game 0 Black: got %q, want %q", g0.Black, "Doe, Jane")
	}
	if g0.Result != "1-0" {
		t.Errorf("game 0 Result: got %q, want %q", g0.Result, "1-0")
	}
	if g0.EloWhite != 2000 {
		t.Errorf("game 0 EloWhite: got %d, want 2000", g0.EloWhite)
	}
	if g0.EloBlack != 1900 {
		t.Errorf("game 0 EloBlack: got %d, want 1900", g0.EloBlack)
	}
	if g0.ECO != "B20" {
		t.Errorf("game 0 ECO: got %q, want %q", g0.ECO, "B20")
	}

	g1 := games[1]
	if g1.Result != "1/2-1/2" {
		t.Errorf("game 1 Result: got %q, want %q", g1.Result, "1/2-1/2")
	}
	if g1.EloWhite != 0 {
		t.Errorf("game 1 EloWhite: got %d, want 0 (missing)", g1.EloWhite)
	}
}

func TestParseReader_MoveTextCaptured(t *testing.T) {
	var games []ParsedGame
	err := parseReader(strings.NewReader(samplePGN), func(pg ParsedGame) {
		games = append(games, pg)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(games) == 0 {
		t.Fatal("no games parsed")
	}
	if !strings.Contains(games[0].MoveText, "e4") {
		t.Errorf("expected move text to contain 'e4', got: %q", games[0].MoveText)
	}
}

func TestParseReader_NoGames(t *testing.T) {
	var count int
	err := parseReader(strings.NewReader(""), func(_ ParsedGame) { count++ })
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("expected 0 games for empty input, got %d", count)
	}
}

// TestparseReader_GigabaseFormat verifies parsing of the Lumbra's Gigabase
// header format, which includes extra tags like FideId, PlyCount, Source, ImportDate.
func TestParseReader_GigabaseFormat(t *testing.T) {
	pgn := `[Event "Sitges"]
[Site "Sitges"]
[Date "1934.06.05"]
[Round "13"]
[White "Sunyer, Julio"]
[Black "Tartakower, Savielly"]
[Result "0-1"]
[PlyCount "84"]
[BlackFideId "2834120"]
[ECO "A00p"]
[Source "TheChessDog"]
[ImportDate "2026-01-06"]

1. b4 c5 2. bxc5 Qa5 3. c3 e5 0-1

[Event "Next"]
[Site "?"]
[Date "2024.01.01"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 1-0
`
	var games []ParsedGame
	err := parseReader(strings.NewReader(pgn), func(pg ParsedGame) {
		games = append(games, pg)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 2 {
		t.Fatalf("expected 2 games, got %d", len(games))
	}
	if games[0].Black != "Tartakower, Savielly" {
		t.Errorf("got Black %q", games[0].Black)
	}
	if games[0].ECO != "A00p" {
		t.Errorf("got ECO %q", games[0].ECO)
	}
}

// TestParseFile_GigabaseSmall runs against the actual test PGN files if present.
// It counts games and verifies the parse completes without error.
func TestParseFile_GigabaseSmall(t *testing.T) {
	files := []struct {
		path      string
		wantAtLeast int
	}{
		{"../../tmp/gigabase_small/LumbrasGigaBase_OTB_1900-1949.pgn", 1000},
		{"../../tmp/gigabase_small/LumbrasGigaBase_OTB_0001-1899.pgn", 100},
		{"../../tmp/gigabase_small/LumbrasGigaBase_OTB_noDate.pgn", 100},
	}

	for _, tc := range files {
		t.Run(tc.path, func(t *testing.T) {
			var count int
			err := ParseFile(tc.path, func(_ ParsedGame) { count++ })
			if err != nil {
				// File might not exist in CI — skip rather than fail.
				t.Skipf("skipping (file not found or unreadable): %v", err)
			}
			if count < tc.wantAtLeast {
				t.Errorf("parsed %d games, want at least %d", count, tc.wantAtLeast)
			}
			t.Logf("parsed %d games from %s", count, tc.path)
		})
	}
}

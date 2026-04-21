package game

import (
	"strings"
	"testing"
)

const singleGame = `[Event "World Championship"]
[Site "London"]
[Date "2013.11.22"]
[White "Carlsen, Magnus"]
[Black "Anand, Viswanathan"]
[Result "1-0"]
[WhiteElo "2870"]
[BlackElo "2775"]
[ECO "D31"]

1. d4 d5 2. c4 c6 3. Nc3 Nf6 1-0`

const twoGames = `[Event "Game 1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 1-0

[Event "Game 2"]
[White "Carol"]
[Black "Dave"]
[Result "0-1"]

1. d4 d5 0-1`

func TestParseSingleGame(t *testing.T) {
	games, err := ParsePGN(singleGame)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	g := games[0]
	if g.White != "Carlsen, Magnus" {
		t.Errorf("White: got %q, want %q", g.White, "Carlsen, Magnus")
	}
	if g.Black != "Anand, Viswanathan" {
		t.Errorf("Black: got %q, want %q", g.Black, "Anand, Viswanathan")
	}
	if g.Result != "1-0" {
		t.Errorf("Result: got %q, want %q", g.Result, "1-0")
	}
	if g.Date != "2013.11.22" {
		t.Errorf("Date: got %q, want %q", g.Date, "2013.11.22")
	}
	if g.ECO != "D31" {
		t.Errorf("ECO: got %q, want %q", g.ECO, "D31")
	}
	if g.Event != "World Championship" {
		t.Errorf("Event: got %q, want %q", g.Event, "World Championship")
	}
	if g.WhiteElo == nil || *g.WhiteElo != 2870 {
		t.Errorf("WhiteElo: got %v, want 2870", g.WhiteElo)
	}
	if g.BlackElo == nil || *g.BlackElo != 2775 {
		t.Errorf("BlackElo: got %v, want 2775", g.BlackElo)
	}
}

func TestParseMultipleGames(t *testing.T) {
	games, err := ParsePGN(twoGames)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("expected 2 games, got %d", len(games))
	}
	if games[0].White != "Alice" || games[0].Event != "Game 1" {
		t.Errorf("game 1 mismatch: %+v", games[0])
	}
	if games[1].White != "Carol" || games[1].Event != "Game 2" {
		t.Errorf("game 2 mismatch: %+v", games[1])
	}
}

func TestParseEmpty(t *testing.T) {
	games, err := ParsePGN("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(games) != 0 {
		t.Fatalf("expected 0 games for empty input, got %d", len(games))
	}
}

func TestUTCDateAndTime(t *testing.T) {
	pgn := `[Event "Lichess Game"]
[UTCDate "2024.03.15"]
[UTCTime "14:32:07"]
[White "PlayerA"]
[Black "PlayerB"]
[Result "1/2-1/2"]

1. e4 e5 1/2-1/2`
	games, err := ParsePGN(pgn)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	want := "2024.03.15 14:32:07"
	if games[0].Date != want {
		t.Errorf("Date: got %q, want %q", games[0].Date, want)
	}
}

func TestUTCDateFallsBackToDate(t *testing.T) {
	pgn := `[Event "Chess.com Game"]
[Date "2024.03.15"]
[Time "10:05:00"]
[White "PlayerA"]
[Black "PlayerB"]
[Result "1-0"]

1. d4 d5 1-0`
	games, err := ParsePGN(pgn)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	want := "2024.03.15 10:05:00"
	if games[0].Date != want {
		t.Errorf("Date: got %q, want %q", games[0].Date, want)
	}
}

func TestDefaultResult(t *testing.T) {
	pgn := `[Event "Test"]
[White "A"]
[Black "B"]

1. e4`
	games, _ := ParsePGN(pgn)
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	if games[0].Result != "*" {
		t.Errorf("expected default result *, got %q", games[0].Result)
	}
}

func TestSourceIDIsSetForPGNImport(t *testing.T) {
	games, err := ParsePGN(singleGame)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	if games[0].SourceID == "" {
		t.Error("expected SourceID to be set for pgn_import games, got empty string")
	}
}

func TestSourceIDIsDeterministic(t *testing.T) {
	games1, _ := ParsePGN(singleGame)
	games2, _ := ParsePGN(singleGame)
	if games1[0].SourceID != games2[0].SourceID {
		t.Errorf("SourceID not deterministic: %q vs %q", games1[0].SourceID, games2[0].SourceID)
	}
}

func TestSourceIDDiffersForDifferentGames(t *testing.T) {
	games, _ := ParsePGN(twoGames)
	if len(games) != 2 {
		t.Fatalf("expected 2 games, got %d", len(games))
	}
	if games[0].SourceID == games[1].SourceID {
		t.Error("expected different SourceIDs for different games")
	}
}

func TestSourceIDIgnoresComments(t *testing.T) {
	// Same game, one with comments and one without — should get the same SourceID.
	pgnWithComments := `[White "A"][Black "B"][Date "2024.01.01"][Result "1-0"]
1. e4 {good move} e5 { response } 1-0`
	pgnWithout := `[White "A"][Black "B"][Date "2024.01.01"][Result "1-0"]
1. e4 e5 1-0`
	g1, _ := ParsePGN(pgnWithComments)
	g2, _ := ParsePGN(pgnWithout)
	if g1[0].SourceID != g2[0].SourceID {
		t.Errorf("SourceID should be the same regardless of comments: %q vs %q",
			g1[0].SourceID, g2[0].SourceID)
	}
}

func TestUpdateHeaders(t *testing.T) {
	elo2500 := 2500
	elo2600 := 2600

	t.Run("replaces known tags", func(t *testing.T) {
		pgn := `[Event "World Championship"]
[Site "London"]
[Date "2013.11.22"]
[White "Carlsen, Magnus"]
[Black "Anand, Viswanathan"]
[Result "1-0"]
[WhiteElo "2870"]
[BlackElo "2775"]
[ECO "D31"]
[Round "1"]

1. d4 d5 2. c4 c6 1-0`

		m := GameMetadataInput{
			White:    "Nakamura, Hikaru",
			Black:    "So, Wesley",
			WhiteElo: &elo2500,
			BlackElo: &elo2600,
			Result:   "1/2-1/2",
			Date:     "2024.01.15",
			Event:    "Candidates",
			Site:     "Toronto",
			Round:    "5",
			ECO:      "E60",
		}

		got := UpdateHeaders(pgn, m)
		headers := extractHeaders(got)

		if headers["White"] != "Nakamura, Hikaru" {
			t.Errorf("White: got %q", headers["White"])
		}
		if headers["Black"] != "So, Wesley" {
			t.Errorf("Black: got %q", headers["Black"])
		}
		if headers["WhiteElo"] != "2500" {
			t.Errorf("WhiteElo: got %q", headers["WhiteElo"])
		}
		if headers["BlackElo"] != "2600" {
			t.Errorf("BlackElo: got %q", headers["BlackElo"])
		}
		if headers["Result"] != "1/2-1/2" {
			t.Errorf("Result: got %q", headers["Result"])
		}
		if headers["Date"] != "2024.01.15" {
			t.Errorf("Date: got %q", headers["Date"])
		}
		if headers["Event"] != "Candidates" {
			t.Errorf("Event: got %q", headers["Event"])
		}
		if headers["Site"] != "Toronto" {
			t.Errorf("Site: got %q", headers["Site"])
		}
		if headers["Round"] != "5" {
			t.Errorf("Round: got %q", headers["Round"])
		}
		if headers["ECO"] != "E60" {
			t.Errorf("ECO: got %q", headers["ECO"])
		}
	})

	t.Run("inserts missing tags", func(t *testing.T) {
		// PGN with no ECO, Round, or Site tags.
		pgn := `[Event "Club Game"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 1-0`

		m := GameMetadataInput{
			White:  "Alice",
			Black:  "Bob",
			Result: "1-0",
			Date:   "2024.06.01",
			Event:  "Club Game",
			Site:   "New York",
			Round:  "3",
			ECO:    "C20",
		}

		got := UpdateHeaders(pgn, m)
		headers := extractHeaders(got)

		if headers["Site"] != "New York" {
			t.Errorf("Site (inserted): got %q", headers["Site"])
		}
		if headers["Round"] != "3" {
			t.Errorf("Round (inserted): got %q", headers["Round"])
		}
		if headers["ECO"] != "C20" {
			t.Errorf("ECO (inserted): got %q", headers["ECO"])
		}
		if headers["Date"] != "2024.06.01" {
			t.Errorf("Date (inserted): got %q", headers["Date"])
		}
	})

	t.Run("omits nil Elos", func(t *testing.T) {
		pgn := `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1800"]
[BlackElo "1900"]
[Result "1-0"]

1. e4 1-0`

		m := GameMetadataInput{
			White:    "Alice",
			Black:    "Bob",
			WhiteElo: nil,
			BlackElo: nil,
			Result:   "1-0",
			Date:     "2024.01.01",
			Event:    "Test",
		}

		got := UpdateHeaders(pgn, m)
		headers := extractHeaders(got)

		if _, ok := headers["WhiteElo"]; ok {
			t.Errorf("WhiteElo should be absent when nil, got %q", headers["WhiteElo"])
		}
		if _, ok := headers["BlackElo"]; ok {
			t.Errorf("BlackElo should be absent when nil, got %q", headers["BlackElo"])
		}
	})

	t.Run("preserves other tags and movetext", func(t *testing.T) {
		pgn := `[Event "Lichess Game"]
[Site "lichess.org"]
[Date "2024.03.15"]
[White "PlayerA"]
[Black "PlayerB"]
[Result "1/2-1/2"]
[WhiteElo "2000"]
[BlackElo "2100"]
[ECO "B20"]
[Round "-"]
[TimeControl "180+2"]
[Opening "Sicilian Defense"]

1. e4 c5 1/2-1/2`

		m := GameMetadataInput{
			White:  "PlayerA",
			Black:  "PlayerB",
			Result: "1/2-1/2",
			Date:   "2024.03.15",
			Event:  "Lichess Game",
			Site:   "lichess.org",
			Round:  "-",
			ECO:    "B20",
		}

		got := UpdateHeaders(pgn, m)
		headers := extractHeaders(got)

		// Unmanaged tags must survive.
		if headers["TimeControl"] != "180+2" {
			t.Errorf("TimeControl should be preserved: got %q", headers["TimeControl"])
		}
		if headers["Opening"] != "Sicilian Defense" {
			t.Errorf("Opening should be preserved: got %q", headers["Opening"])
		}

		// Move text must be intact.
		if !strings.Contains(got, "1. e4 c5 1/2-1/2") {
			t.Errorf("move text not preserved in output:\n%s", got)
		}
	})
}

func TestNormalizeMoves(t *testing.T) {
	pgn := `[White "A"][Black "B"][Result "1-0"]
1. e4! e5? 2. Nf3!! Nc6?! (2... d6 3. d4) {main line} 1-0`
	got := normalizeMoves(pgn)
	// Variations, comments, NAGs, annotation suffixes, result tokens, and move
	// numbers are all stripped. Remaining SAN tokens are lowercased.
	want := "e4 e5 nf3 nc6"
	if got != want {
		t.Errorf("normalizeMoves: got %q, want %q", got, want)
	}
}

func TestGameHash(t *testing.T) {
	pgn := `[White "Alice"][Black "Bob"][Date "2024.01.01"][Result "1-0"]
1. e4 e5 1-0`

	t.Run("is deterministic", func(t *testing.T) {
		h1 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		h2 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		if h1 != h2 {
			t.Errorf("not deterministic: %q vs %q", h1, h2)
		}
	})

	t.Run("is 16 hex chars", func(t *testing.T) {
		h := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		if len(h) != 16 {
			t.Errorf("expected 16 chars, got %d: %q", len(h), h)
		}
	})

	t.Run("differs from pgn_import SourceID (contentHash omits result)", func(t *testing.T) {
		games, _ := ParsePGN(pgn)
		gameHash := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		if games[0].SourceID == gameHash {
			t.Error("GameHash and contentHash (SourceID) must not be equal — they cover different fields")
		}
	})

	t.Run("different result produces different hash", func(t *testing.T) {
		h1 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		h2 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "0-1")
		if h1 == h2 {
			t.Error("expected different hashes for different results")
		}
	})

	t.Run("case-insensitive on player names", func(t *testing.T) {
		h1 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		h2 := GameHash(pgn, "ALICE", "BOB", "2024.01.01", "1-0")
		if h1 != h2 {
			t.Errorf("expected same hash regardless of name casing: %q vs %q", h1, h2)
		}
	})

	t.Run("date truncated to 10 chars", func(t *testing.T) {
		h1 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		h2 := GameHash(pgn, "Alice", "Bob", "2024.01.01 14:30:00", "1-0")
		if h1 != h2 {
			t.Errorf("expected same hash for date with/without time: %q vs %q", h1, h2)
		}
	})

	t.Run("annotation-insensitive", func(t *testing.T) {
		pgnAnnotated := `[White "Alice"][Black "Bob"][Date "2024.01.01"][Result "1-0"]
1. e4 {great move} e5 {?} 1-0`
		h1 := GameHash(pgn, "Alice", "Bob", "2024.01.01", "1-0")
		h2 := GameHash(pgnAnnotated, "Alice", "Bob", "2024.01.01", "1-0")
		if h1 != h2 {
			t.Errorf("expected same hash regardless of annotations: %q vs %q", h1, h2)
		}
	})
}

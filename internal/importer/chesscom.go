package importer

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

const (
	chessComBaseURL = "https://api.chess.com/pub/player"

	// chesscomRequestTimeout covers a single paginated API response.
	// Chess.com paginates at 100 games/request so individual requests are small.
	chesscomRequestTimeout = 30 * time.Second
)

// FetchChessCom downloads games for username from the chess.com public API
// and returns them as parsed GameInputs.
func FetchChessCom(username string, filters ImportFilters) ([]game.GameInput, error) {
	if username == "" {
		return nil, fmt.Errorf("username is required")
	}

	months, err := monthsInRange(filters.DateFrom, filters.DateTo)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: chesscomRequestTimeout}
	var all []game.GameInput

	for _, ym := range months {
		endpoint := fmt.Sprintf("%s/%s/games/%d/%02d",
			chessComBaseURL, url.PathEscape(strings.ToLower(username)),
			ym[0], ym[1],
		)
		games, err := fetchChessComMonth(client, endpoint, filters.TimeControls)
		if err != nil {
			return nil, err
		}
		all = append(all, games...)
		if filters.MaxGames > 0 && len(all) >= filters.MaxGames {
			all = all[:filters.MaxGames]
			break
		}
	}
	return all, nil
}

type chessComArchive struct {
	Games []chessComGame `json:"games"`
}

type chessComGame struct {
	PGN string `json:"pgn"`
	URL string `json:"url"`
}

func fetchChessComMonth(client *http.Client, endpoint string, timeControlFilters []string) ([]game.GameInput, error) {
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build chess.com request: %w", err)
	}
	req.Header.Set("User-Agent", "Masterboard/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("chess.com request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil // no games for that month
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("chess.com API returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read chess.com response: %w", err)
	}

	var archive chessComArchive
	if err := json.Unmarshal(body, &archive); err != nil {
		return nil, fmt.Errorf("parse chess.com response: %w", err)
	}

	var games []game.GameInput
	for _, cg := range archive.Games {
		if cg.PGN == "" {
			continue
		}
		parsed, err := game.ParsePGN(cg.PGN)
		if err != nil || len(parsed) == 0 {
			continue
		}
		g := parsed[0]
		g.Source = "chess_com"
		g.SourceID = cg.URL

		if len(timeControlFilters) > 0 && !matchesAnyTimeControl(g.TimeControl, timeControlFilters) {
			continue
		}
		games = append(games, g)
	}
	return games, nil
}

func matchesAnyTimeControl(tc string, categories []string) bool {
	for _, cat := range categories {
		if matchesTimeControl(tc, cat) {
			return true
		}
	}
	return false
}

// matchesTimeControl checks if a PGN TimeControl string matches the requested category.
func matchesTimeControl(tc, category string) bool {
	cat := strings.ToLower(category)
	// correspondence has no clock — special case not covered by CategorizeTimeControl
	if cat == "correspondence" {
		return game.ParseTimeControlSecs(tc) == 0
	}
	return strings.EqualFold(game.CategorizeTimeControl(tc), cat)
}

// monthsInRange returns [year, month] pairs between dateFrom and dateTo (inclusive).
// If both are empty, returns the current month only.
func monthsInRange(from, to string) ([][2]int, error) {
	now := time.Now()

	var start, end time.Time
	var err error

	if from != "" {
		start, err = time.Parse("2006-01-02", from)
		if err != nil {
			return nil, fmt.Errorf("invalid dateFrom: %w", err)
		}
	} else {
		start = time.Date(now.Year()-1, now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}

	if to != "" {
		end, err = time.Parse("2006-01-02", to)
		if err != nil {
			return nil, fmt.Errorf("invalid dateTo: %w", err)
		}
	} else {
		end = now
	}

	var months [][2]int
	cur := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	endMonth := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, time.UTC)
	for !cur.After(endMonth) {
		months = append(months, [2]int{cur.Year(), int(cur.Month())})
		cur = cur.AddDate(0, 1, 0)
	}
	return months, nil
}

package importer

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

const (
	lichessBaseURL = "https://lichess.org/api/games/user"

	// lichessStreamTimeout is generous because Lichess streams games as NDJSON;
	// a single request may stream thousands of games with no intermediate reads.
	lichessStreamTimeout = 120 * time.Second
)

// FetchLichess downloads PGN games for username from the lichess.org public API
// and returns them as parsed GameInputs.
func FetchLichess(username string, filters ImportFilters) ([]game.GameInput, error) {
	if username == "" {
		return nil, fmt.Errorf("username is required")
	}

	params := url.Values{}
	params.Set("format", "pgn")
	params.Set("clocks", "false")
	params.Set("evals", "false")
	params.Set("opening", "true")

	if filters.DateFrom != "" {
		if ms, err := dateToMillis(filters.DateFrom); err == nil {
			params.Set("since", strconv.FormatInt(ms, 10))
		}
	}
	if filters.DateTo != "" {
		if ms, err := dateToMillis(filters.DateTo); err == nil {
			// Add one full day minus 1 ms so "until 2026-03-29" includes the
			// entire day rather than cutting off at midnight.
			params.Set("until", strconv.FormatInt(ms+24*60*60*1000-1, 10))
		}
	}
	if len(filters.TimeControls) > 0 {
		var perfTypes []string
		for _, tc := range filters.TimeControls {
			if pt := lichessPerfType(tc); pt != "" {
				perfTypes = append(perfTypes, pt)
			}
		}
		if len(perfTypes) > 0 {
			params.Set("perfType", strings.Join(perfTypes, ","))
		}
	}
	if filters.MaxGames > 0 {
		params.Set("max", strconv.Itoa(filters.MaxGames))
	}

	endpoint := fmt.Sprintf("%s/%s?%s", lichessBaseURL, url.PathEscape(username), params.Encode())

	client := &http.Client{Timeout: lichessStreamTimeout}
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/x-chess-pgn")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch lichess: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("lichess user %q not found", username)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess API returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	games, err := game.ParsePGN(string(body))
	if err != nil {
		return nil, fmt.Errorf("parse pgn: %w", err)
	}

	// Tag each game as coming from lichess.
	for i := range games {
		games[i].Source = "lichess"
		games[i].SourceID = game.ExtractHeader(games[i].PGN, "Site")
	}
	return games, nil
}

func lichessPerfType(tc string) string {
	switch strings.ToLower(tc) {
	case "bullet":
		return "bullet"
	case "blitz":
		return "blitz"
	case "rapid":
		return "rapid"
	case "classical":
		return "classical"
	case "correspondence":
		return "correspondence"
	default:
		return ""
	}
}

func dateToMillis(date string) (int64, error) {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return 0, err
	}
	return t.UnixMilli(), nil
}

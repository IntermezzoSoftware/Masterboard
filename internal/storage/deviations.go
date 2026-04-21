package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	chess "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/masterdb"
)

// DeviationResult is cached in game_deviations and returned by DetectDeviation.
// DeviationPly == -1 means no deviation (fully in-repertoire, not personal, or no repertoire).
type DeviationResult struct {
	GameID            string   `json:"gameId"`
	DeviationPly      int      `json:"deviationPly"`
	DeviationFEN      string   `json:"deviationFen"`
	PlayerWentOffBook bool     `json:"playerWentOffBook"`
	RepertoireID      string   `json:"repertoireId"`
	ExpectedMoves     []string `json:"expectedMoves"`
	PlayedMove        string   `json:"playedMove"`
}

type repEntry struct {
	sans  []string
	repID string
}

// DetectDeviation finds the first position where the player left their repertoire.
// Returns cached result if available; otherwise computes and caches.
func (d *DB) DetectDeviation(gameID string) (*DeviationResult, error) {
	cached, err := d.GetGameDeviation(gameID)
	if err == nil && cached != nil {
		return cached, nil
	}

	var white, black, pgn string
	if err := d.db.QueryRow(
		`SELECT white, black, pgn FROM games WHERE id = ?`, gameID,
	).Scan(&white, &black, &pgn); err != nil {
		return nil, fmt.Errorf("load game %s: %w", gameID, err)
	}

	playerColour := ""
	for _, name := range d.GetIdentityNames() {
		if strings.EqualFold(name, white) {
			playerColour = "white"
			break
		}
		if strings.EqualFold(name, black) {
			playerColour = "black"
			break
		}
	}
	noDev := &DeviationResult{GameID: gameID, DeviationPly: -1}
	if playerColour == "" {
		return d.cacheDeviation(noDev)
	}

	repRows, err := d.db.Query(`SELECT id FROM repertoires WHERE colour = ?`, playerColour)
	if err != nil {
		return nil, fmt.Errorf("load repertoires: %w", err)
	}
	var repIDs []string
	for repRows.Next() {
		var id string
		if scanErr := repRows.Scan(&id); scanErr == nil {
			repIDs = append(repIDs, id)
		}
	}
	repRows.Close()

	if len(repIDs) == 0 {
		return d.cacheDeviation(noDev)
	}

	// Build repertoire hash-map: positionHash → {sans, repID}
	repMap := make(map[int64]*repEntry)
	for _, rid := range repIDs {
		rows, err := d.db.Query(
			`SELECT from_fen, move_san FROM repertoire_moves WHERE repertoire_id = ?`, rid)
		if err != nil {
			return nil, fmt.Errorf("load repertoire moves: %w", err)
		}
		for rows.Next() {
			var fromFEN, san string
			if scanErr := rows.Scan(&fromFEN, &san); scanErr != nil {
				continue
			}
			h, err := masterdb.HashFEN(fromFEN)
			if err != nil {
				continue
			}
			e := repMap[h]
			if e == nil {
				e = &repEntry{repID: rid}
				repMap[h] = e
			}
			e.sans = append(e.sans, san)
		}
		rows.Close()
	}

	// Replay PGN to walk positions in order.
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		return d.cacheDeviation(noDev)
	}
	g := chess.NewGame()
	updateFn(g)
	positions := g.Positions()
	moves := g.Moves()

	an := chess.AlgebraicNotation{}

	for i, move := range moves {
		pos := positions[i]
		h, err := masterdb.HashFEN(pos.String())
		if err != nil {
			continue
		}

		entry, inRepertoire := repMap[h]
		if !inRepertoire {
			// Position not in repertoire — walked past preparation depth; no deviation.
			break
		}

		moveSAN := an.Encode(pos, move)
		matched := false
		for _, s := range entry.sans {
			if s == moveSAN {
				matched = true
				break
			}
		}
		if !matched {
			isPlayerTurn := (i%2 == 0) == (playerColour == "white")
			devFEN := pos.String()
			return d.cacheDeviation(&DeviationResult{
				GameID:            gameID,
				DeviationPly:      i,
				DeviationFEN:      devFEN,
				PlayerWentOffBook: isPlayerTurn,
				RepertoireID:      entry.repID,
				ExpectedMoves:     entry.sans,
				PlayedMove:        moveSAN,
			})
		}
	}

	return d.cacheDeviation(noDev)
}

// GetGameDeviation fetches a cached deviation result. Returns nil, nil if not cached.
func (d *DB) GetGameDeviation(gameID string) (*DeviationResult, error) {
	var r DeviationResult
	var deviationFEN, repertoireID, expectedJSON, playedMove sql.NullString
	var playerOffBook int

	err := d.db.QueryRow(`
		SELECT game_id, deviation_ply, deviation_fen, player_off_book,
		       repertoire_id, expected_moves, played_move
		FROM game_deviations WHERE game_id = ?`, gameID,
	).Scan(&r.GameID, &r.DeviationPly, &deviationFEN, &playerOffBook,
		&repertoireID, &expectedJSON, &playedMove)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.PlayerWentOffBook = playerOffBook == 1
	if deviationFEN.Valid {
		r.DeviationFEN = deviationFEN.String
	}
	if repertoireID.Valid {
		r.RepertoireID = repertoireID.String
	}
	if playedMove.Valid {
		r.PlayedMove = playedMove.String
	}
	if expectedJSON.Valid && expectedJSON.String != "" {
		json.Unmarshal([]byte(expectedJSON.String), &r.ExpectedMoves) //nolint:errcheck
	}
	return &r, nil
}

// ClearDeviationCache deletes all cached deviation results.
// Call after any repertoire mutation.
func (d *DB) ClearDeviationCache() error {
	_, err := d.db.Exec(`DELETE FROM game_deviations`)
	return err
}

// DetectDeviationsForGames runs DetectDeviation on each gameID.
func (d *DB) DetectDeviationsForGames(gameIDs []string) ([]DeviationResult, error) {
	out := make([]DeviationResult, 0, len(gameIDs))
	for _, id := range gameIDs {
		r, err := d.DetectDeviation(id)
		if err != nil {
			return out, fmt.Errorf("detect deviation for %s: %w", id, err)
		}
		if r != nil {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (d *DB) cacheDeviation(r *DeviationResult) (*DeviationResult, error) {
	expectedJSON, _ := json.Marshal(r.ExpectedMoves)
	playerOffBook := 0
	if r.PlayerWentOffBook {
		playerOffBook = 1
	}
	_, err := d.db.Exec(`
		INSERT OR REPLACE INTO game_deviations
		    (game_id, deviation_ply, deviation_fen, player_off_book,
		     repertoire_id, expected_moves, played_move, detected_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.GameID, r.DeviationPly, nullString(r.DeviationFEN), playerOffBook,
		nullString(r.RepertoireID), string(expectedJSON), nullString(r.PlayedMove),
		now(),
	)
	if err != nil {
		return nil, fmt.Errorf("cache deviation: %w", err)
	}
	return r, nil
}

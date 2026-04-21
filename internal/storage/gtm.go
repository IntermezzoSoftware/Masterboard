package storage

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"

	chess "github.com/corentings/chess/v2"

	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
)

// GTMMove is a single half-move in a Guess the Move session.
// BestUCI, BestCP and PlayedCP are nil when the game has not been analysed.
type GTMMove struct {
	Ply      int     `json:"ply"`
	FromFen  string  `json:"fromFen"`
	ToFen    string  `json:"toFen"`
	San      string  `json:"san"`
	UCI      string  `json:"uci"`
	Colour   string  `json:"colour"`
	BestUCI  *string `json:"bestUci"`
	BestCP   *int    `json:"bestCp"`
	PlayedCP *int    `json:"playedCp"`
}

// GTMGame is the payload returned by GetGTMGame.
type GTMGame struct {
	GameID   string    `json:"gameId"`
	White    string    `json:"white"`
	Black    string    `json:"black"`
	Date     string    `json:"date"`
	Result   string    `json:"result"`
	Analysed bool      `json:"analysed"`
	Moves    []GTMMove `json:"moves"`
}

// GTMRating holds the current Guess the Move Elo rating.
type GTMRating struct {
	Rating      int `json:"rating"`
	GamesPlayed int `json:"gamesPlayed"`
}

// GetGTMGame loads a game's moves from the database, attaches eval data if a
// complete analysis exists, and returns the flat move list for a GTM session.
func (d *DB) GetGTMGame(gameID string) (*GTMGame, error) {
	var white, black, date, result, pgn string
	err := d.db.QueryRow(
		`SELECT white, black, date, result, pgn FROM games WHERE id = ?`, gameID,
	).Scan(&white, &black, &date, &result, &pgn)
	if err != nil {
		return nil, fmt.Errorf("load game %s: %w", gameID, err)
	}

	var evalsJSON string
	d.db.QueryRow( //nolint:errcheck
		`SELECT COALESCE(evals, '') FROM game_analyses WHERE game_id = ? AND status = 'complete'`,
		gameID,
	).Scan(&evalsJSON)

	var evalsByPly map[int]analysis.MoveEval
	if evalsJSON != "" {
		var evals []analysis.MoveEval
		if err := json.Unmarshal([]byte(evalsJSON), &evals); err != nil {
			log.Printf("gtm: failed to unmarshal evals for game %s: %v", gameID, err)
		} else {
			evalsByPly = make(map[int]analysis.MoveEval, len(evals))
			for _, e := range evals {
				evalsByPly[e.Ply] = e
			}
		}
	}

	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		return nil, fmt.Errorf("parse pgn for game %s: %w", gameID, err)
	}
	g := chess.NewGame()
	updateFn(g)

	positions := g.Positions()
	moves := g.Moves()
	an := chess.AlgebraicNotation{}
	uciN := chess.UCINotation{}

	gtmMoves := make([]GTMMove, 0, len(moves))
	for i, move := range moves {
		ply := i + 1
		pos := positions[i]
		colour := "white"
		if ply%2 == 0 {
			colour = "black"
		}
		m := GTMMove{
			Ply:     ply,
			FromFen: pos.String(),
			ToFen:   pos.Update(move).String(),
			San:     an.Encode(pos, move),
			UCI:     uciN.Encode(pos, move),
			Colour:  colour,
		}
		if ev, ok := evalsByPly[ply]; ok {
			if ev.BestPV != "" {
				bestUCI := strings.Fields(ev.BestPV)[0]
				m.BestUCI = &bestUCI
			}
			m.BestCP = ev.BestCp
			m.PlayedCP = ev.PlayedCp
		}
		gtmMoves = append(gtmMoves, m)
	}

	return &GTMGame{
		GameID:   gameID,
		White:    white,
		Black:    black,
		Date:     date,
		Result:   result,
		Analysed: evalsByPly != nil,
		Moves:    gtmMoves,
	}, nil
}

// InsertGTMResult persists a completed GTM session to gtm_results.
func (d *DB) InsertGTMResult(gameID, colour string, pointsEarned, maxPoints, moveCount int, analysed bool) error {
	analysedInt := 0
	if analysed {
		analysedInt = 1
	}
	_, err := d.db.Exec(`
		INSERT INTO gtm_results (game_id, colour, points_earned, max_points, move_count, analysed, played_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		gameID, colour, pointsEarned, maxPoints, moveCount, analysedInt, now(),
	)
	if err != nil {
		return fmt.Errorf("insert gtm_result: %w", err)
	}
	return nil
}

// GetGTMRating returns the current GTM Elo rating and games played.
// Returns defaults (1500, 0) if no settings exist yet.
func (d *DB) GetGTMRating() (GTMRating, error) {
	ratingStr, err := d.GetSetting("gtm.rating")
	if err != nil {
		return GTMRating{}, err
	}
	gamesStr, err := d.GetSetting("gtm.games_played")
	if err != nil {
		return GTMRating{}, err
	}
	rating := 1500
	if ratingStr != "" {
		if v, err2 := strconv.Atoi(ratingStr); err2 == nil {
			rating = v
		}
	}
	games := 0
	if gamesStr != "" {
		if v, err2 := strconv.Atoi(gamesStr); err2 == nil {
			games = v
		}
	}
	return GTMRating{Rating: rating, GamesPlayed: games}, nil
}

// UpdateGTMRating recomputes the GTM Elo after a session and persists it.
// S = pointsEarned / maxPoints (0.0–1.0); opponent fixed at 2000; K = 40 (<30 games) or 20 (≥30).
func (d *DB) UpdateGTMRating(pointsEarned, maxPoints int) (GTMRating, error) {
	current, err := d.GetGTMRating()
	if err != nil {
		return GTMRating{}, err
	}
	var s float64
	if maxPoints > 0 {
		s = float64(pointsEarned) / float64(maxPoints)
	}
	const opponentRating = 2000.0
	e := 1.0 / (1.0 + math.Pow(10, (opponentRating-float64(current.Rating))/400.0))
	k := 40.0
	if current.GamesPlayed >= 30 {
		k = 20.0
	}
	newRating := int(math.Round(float64(current.Rating) + k*(s-e)))
	newGames := current.GamesPlayed + 1
	tx, err := d.db.Begin()
	if err != nil {
		return GTMRating{}, err
	}
	_, err = tx.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		"gtm.rating", strconv.Itoa(newRating), now(),
	)
	if err != nil {
		tx.Rollback() //nolint:errcheck
		return GTMRating{}, err
	}
	_, err = tx.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		"gtm.games_played", strconv.Itoa(newGames), now(),
	)
	if err != nil {
		tx.Rollback() //nolint:errcheck
		return GTMRating{}, err
	}
	if err := tx.Commit(); err != nil {
		return GTMRating{}, err
	}
	return GTMRating{Rating: newRating, GamesPlayed: newGames}, nil
}

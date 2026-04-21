package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"
	"time"

	chess "github.com/corentings/chess/v2"
	fsrs "github.com/open-spaced-repetition/go-fsrs/v4"

	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
)

// PersonalPuzzle is a tactical puzzle extracted from a personal game analysis.
type PersonalPuzzle struct {
	ID             string   `json:"id"`
	GameID         string   `json:"gameId"`
	Ply            int      `json:"ply"`
	FEN            string   `json:"fen"`
	SolutionUCI    []string `json:"solutionUci"`
	SolutionSAN    []string `json:"solutionSan"`
	PlayedMove     string   `json:"playedMove"`
	Classification string   `json:"classification"` // "mistake" | "blunder"
	PlayerColour   string   `json:"playerColour"`   // "white" | "black"
	PlayedCp       *int     `json:"playedCp"`       // eval after the blunder, from the player's perspective (100 = 1 pawn)
	BestCp         *int     `json:"bestCp"`         // eval after the best move, from the player's perspective
	White          string   `json:"white"`          // from the source game
	Black          string   `json:"black"`
	Date           string   `json:"date"`
}

// PuzzleSummary holds aggregated review statistics for a puzzle training session.
type PuzzleSummary struct {
	TotalReviewed   int `json:"totalReviewed"`
	CorrectCount    int `json:"correctCount"`
	IncorrectCount  int `json:"incorrectCount"`
	NewToLearning   int `json:"newToLearning"`
	LapsedToRelearn int `json:"lapsedToRelearn"`
}

// TacticsLobbyStats holds the data shown on the Tactics page lobby screen.
type TacticsLobbyStats struct {
	TotalPuzzles    int `json:"totalPuzzles"`
	DueCount        int `json:"dueCount"`
	LifetimeCorrect int `json:"lifetimeCorrect"`
	LifetimeTotal   int `json:"lifetimeTotal"`
}

// PuzzleHistoryEntry is a single row in the drill history view.
type PuzzleHistoryEntry struct {
	PuzzleID       string `json:"puzzleId"`
	GameID         string `json:"gameId"`
	FEN            string `json:"fen"`
	Classification string `json:"classification"`
	PlayerColour   string `json:"playerColour"`
	PlayedMove     string `json:"playedMove"`
	ReviewedAt     string `json:"reviewedAt"`
	Correct        bool   `json:"correct"`
	White          string `json:"white"`
	Black          string `json:"black"`
	Date           string `json:"date"`
}

// PuzzleFilters controls which puzzles are included in session and lobby-stats queries.
type PuzzleFilters struct {
	Classifications      []string `json:"classifications"`      // e.g. ["blunder","mistake"]
	ExcludeAlreadyLosing bool     `json:"excludeAlreadyLosing"` // omit puzzles where best_cp <= AlreadyLosingCP
	AlreadyLosingCP      int      `json:"alreadyLosingCp"`      // threshold in centipawns (player perspective)
}

// puzzleFilterWhere builds a SQL WHERE fragment and arg slice from PuzzleFilters.
// The returned fragment begins with " AND " if non-empty, and is safe to concatenate
// directly after an existing WHERE clause.
func puzzleFilterWhere(f PuzzleFilters) (string, []any) {
	var clauses []string
	var args []any
	if len(f.Classifications) > 0 {
		ph := strings.Repeat("?,", len(f.Classifications))
		clauses = append(clauses, "p.classification IN ("+ph[:len(ph)-1]+")")
		for _, c := range f.Classifications {
			args = append(args, c)
		}
	}
	if f.ExcludeAlreadyLosing {
		clauses = append(clauses, "(p.best_cp IS NULL OR p.best_cp > ?)")
		args = append(args, f.AlreadyLosingCP)
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return " AND " + strings.Join(clauses, " AND "), args
}

// puzzleID generates a stable hex ID for a puzzle from its game ID and ply.
func puzzleID(gameID string, ply int) string {
	h := fnv.New64a()
	h.Write([]byte(gameID + ":" + strconv.Itoa(ply)))
	return fmt.Sprintf("%x", h.Sum64())
}

// loadPuzzleCard reads a FSRS Card from srs_puzzle_entries for the given puzzleID.
// Returns a fresh zero card if no row exists.
func loadPuzzleCard(q sqlQuerier, id string) (fsrs.Card, error) {
	var (
		due           string
		stability     float64
		difficulty    float64
		elapsedDays   int64
		scheduledDays int64
		reps          int64
		lapses        int64
		state         int64
		lastReview    sql.NullString
	)
	err := q.QueryRow(`
		SELECT due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
		FROM srs_puzzle_entries WHERE puzzle_id = ?`, id,
	).Scan(&due, &stability, &difficulty, &elapsedDays, &scheduledDays, &reps, &lapses, &state, &lastReview)
	if errors.Is(err, sql.ErrNoRows) {
		return fsrs.NewCard(), nil
	}
	if err != nil {
		return fsrs.Card{}, fmt.Errorf("load puzzle card %s: %w", id, err)
	}
	card := fsrs.Card{
		Stability:     stability,
		Difficulty:    difficulty,
		ElapsedDays:   uint64(elapsedDays),
		ScheduledDays: uint64(scheduledDays),
		Reps:          uint64(reps),
		Lapses:        uint64(lapses),
		State:         fsrs.State(state),
	}
	if t, err := time.Parse(time.RFC3339, due); err == nil {
		card.Due = t
	}
	if lastReview.Valid {
		if t, err := time.Parse(time.RFC3339, lastReview.String); err == nil {
			card.LastReview = t
		}
	}
	return card, nil
}

// savePuzzleCard upserts a FSRS Card into srs_puzzle_entries for the given puzzle ID.
func savePuzzleCard(tx *sql.Tx, id string, card fsrs.Card) error {
	dueStr := card.Due.UTC().Format(time.RFC3339)
	var lastReviewStr *string
	if !card.LastReview.IsZero() {
		s := card.LastReview.UTC().Format(time.RFC3339)
		lastReviewStr = &s
	}
	_, err := tx.Exec(`
		INSERT INTO srs_puzzle_entries
			(puzzle_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(puzzle_id) DO UPDATE SET
			due            = excluded.due,
			stability      = excluded.stability,
			difficulty     = excluded.difficulty,
			elapsed_days   = excluded.elapsed_days,
			scheduled_days = excluded.scheduled_days,
			reps           = excluded.reps,
			lapses         = excluded.lapses,
			state          = excluded.state,
			last_review    = excluded.last_review`,
		id, dueStr,
		card.Stability, card.Difficulty,
		int64(card.ElapsedDays), int64(card.ScheduledDays),
		int64(card.Reps), int64(card.Lapses),
		int64(card.State), lastReviewStr,
	)
	return err
}

// ExtractPuzzles extracts tactical puzzles from a completed game analysis and
// inserts them into personal_puzzles. Returns the count of newly inserted puzzles.
func (d *DB) ExtractPuzzles(gameID string) (int, error) {
	// Fetch evals JSON from a complete analysis.
	var evalsJSON string
	err := d.db.QueryRow(
		`SELECT COALESCE(evals, '') FROM game_analyses WHERE game_id = ? AND status = 'complete'`,
		gameID,
	).Scan(&evalsJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("fetch evals: %w", err)
	}
	if evalsJSON == "" {
		return 0, nil
	}

	var evals []analysis.MoveEval
	if err := json.Unmarshal([]byte(evalsJSON), &evals); err != nil {
		return 0, fmt.Errorf("unmarshal evals: %w", err)
	}
	if len(evals) == 0 {
		return 0, nil
	}

	// Fetch the PGN and player names.
	var pgn, gameWhite, gameBlack string
	if err := d.db.QueryRow(`SELECT pgn, white, black FROM games WHERE id = ?`, gameID).Scan(&pgn, &gameWhite, &gameBlack); err != nil {
		return 0, fmt.Errorf("fetch pgn: %w", err)
	}

	// Determine which colour the user was playing by matching all configured
	// identity names (Lichess, Chess.com, display name variants) against the
	// game's player names (case-insensitive). If no match is found we fall
	// through and extract puzzles for both sides.
	userColour := ""
	for _, u := range d.GetIdentityNames() {
		if strings.EqualFold(u, gameWhite) {
			userColour = "white"
			break
		}
		if strings.EqualFold(u, gameBlack) {
			userColour = "black"
			break
		}
	}

	// Parse PGN into a chess.Game.
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		return 0, fmt.Errorf("parse pgn: %w", err)
	}
	g := chess.NewGame()
	updateFn(g)

	positions := g.Positions()
	moves := g.Moves()

	inserted := 0
	an := chess.AlgebraicNotation{}
	uciN := chess.UCINotation{}

	for _, eval := range evals {
		if eval.Nag == nil {
			continue
		}
		nag := *eval.Nag
		if nag != 2 && nag != 4 {
			continue
		}
		if eval.BestPV == "" {
			continue
		}

		ply := eval.Ply // 1-indexed
		if ply < 1 || ply > len(moves) || ply >= len(positions) {
			continue
		}

		// Position before the blunder (0-based index = ply-1).
		posBeforeBlunder := positions[ply-1]
		blunderMove := moves[ply-1]

		fen := posBeforeBlunder.String()
		playedSAN := an.Encode(posBeforeBlunder, blunderMove)

		classification := "mistake"
		if nag == 4 {
			classification = "blunder"
		}

		playerColour := "white"
		if ply%2 == 0 {
			playerColour = "black"
		}

		// Skip blunders made by the opponent.
		if userColour != "" && playerColour != userColour {
			continue
		}

		// Convert solution UCI sequence to SAN, replaying from posBeforeBlunder.
		solutionUCIStrs := strings.Fields(eval.BestPV)
		solutionSAN := make([]string, 0, len(solutionUCIStrs))
		pos := posBeforeBlunder
		validSolution := true
		for _, uciStr := range solutionUCIStrs {
			move, err := uciN.Decode(pos, uciStr)
			if err != nil {
				validSolution = false
				break
			}
			solutionSAN = append(solutionSAN, an.Encode(pos, move))
			pos = pos.Update(move)
		}
		if !validSolution {
			continue
		}

		solutionUCIJSON, err := json.Marshal(solutionUCIStrs)
		if err != nil {
			continue
		}
		solutionSANJSON, err := json.Marshal(solutionSAN)
		if err != nil {
			continue
		}

		// Convert BestCp/PlayedCp to the player's perspective (positive = good for this player).
		// MoveEval scores are from white's perspective; negate for black.
		var playedCp, bestCp *int
		if eval.PlayedCp != nil {
			v := *eval.PlayedCp
			if playerColour == "black" {
				v = -v
			}
			playedCp = &v
		}
		if eval.BestCp != nil {
			v := *eval.BestCp
			if playerColour == "black" {
				v = -v
			}
			bestCp = &v
		}

		pid := puzzleID(gameID, ply)
		res, err := d.db.Exec(`
			INSERT OR IGNORE INTO personal_puzzles
				(id, game_id, ply, fen, solution_uci, solution_san, played_move, classification, player_colour, played_cp, best_cp, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			pid, gameID, ply, fen,
			string(solutionUCIJSON), string(solutionSANJSON),
			playedSAN, classification, playerColour, playedCp, bestCp, now(),
		)
		if err != nil {
			return inserted, fmt.Errorf("insert puzzle: %w", err)
		}
		n, _ := res.RowsAffected()
		inserted += int(n)
	}

	// Mark the analysis as having puzzles extracted.
	d.db.Exec(`UPDATE game_analyses SET puzzles_extracted = 1 WHERE game_id = ? AND status = 'complete'`, gameID) //nolint:errcheck

	return inserted, nil
}

// ExtractAllPuzzles extracts puzzles from all complete, unprocessed game analyses.
// Returns the total count of newly inserted puzzles.
func (d *DB) ExtractAllPuzzles() (int, error) {
	rows, err := d.db.Query(
		`SELECT game_id FROM game_analyses WHERE status = 'complete' AND puzzles_extracted = 0`,
	)
	if err != nil {
		return 0, fmt.Errorf("list unprocessed analyses: %w", err)
	}
	var gameIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		gameIDs = append(gameIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	total := 0
	for _, gid := range gameIDs {
		n, err := d.ExtractPuzzles(gid)
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

// GetPuzzleSession returns up to limit puzzles that are due for review.
// New puzzles (no SRS entry) are returned first, then by ascending due date.
func (d *DB) GetPuzzleSession(limit int, f PuzzleFilters) ([]PersonalPuzzle, error) {
	nowStr := now()
	filterWhere, filterArgs := puzzleFilterWhere(f)
	args := append([]any{nowStr}, filterArgs...)
	args = append(args, limit)
	rows, err := d.db.Query(`
		SELECT p.id, p.game_id, p.ply, p.fen, p.solution_uci, p.solution_san,
		       p.played_move, p.classification, p.player_colour, p.played_cp, p.best_cp,
		       COALESCE(g.white, ''), COALESCE(g.black, ''), COALESCE(g.date, '')
		FROM personal_puzzles p
		LEFT JOIN srs_puzzle_entries e ON e.puzzle_id = p.id
		LEFT JOIN games g ON g.id = p.game_id
		WHERE (e.puzzle_id IS NULL OR e.due <= ?)`+filterWhere+`
		ORDER BY e.puzzle_id IS NULL DESC, e.due ASC
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("get puzzle session: %w", err)
	}
	defer rows.Close()

	var puzzles []PersonalPuzzle
	for rows.Next() {
		var p PersonalPuzzle
		var solutionUCIJSON, solutionSANJSON string
		if err := rows.Scan(
			&p.ID, &p.GameID, &p.Ply, &p.FEN,
			&solutionUCIJSON, &solutionSANJSON,
			&p.PlayedMove, &p.Classification, &p.PlayerColour, &p.PlayedCp, &p.BestCp,
			&p.White, &p.Black, &p.Date,
		); err != nil {
			return nil, fmt.Errorf("scan puzzle: %w", err)
		}
		if err := json.Unmarshal([]byte(solutionUCIJSON), &p.SolutionUCI); err != nil {
			return nil, fmt.Errorf("unmarshal solution_uci: %w", err)
		}
		if err := json.Unmarshal([]byte(solutionSANJSON), &p.SolutionSAN); err != nil {
			return nil, fmt.Errorf("unmarshal solution_san: %w", err)
		}
		puzzles = append(puzzles, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return puzzles, nil
}

// RecordPuzzleResult updates FSRS state for a puzzle after a review.
// correct=true maps to fsrs.Good (rating 3); correct=false maps to fsrs.Again (rating 1).
func (d *DB) RecordPuzzleResult(puzzleID string, correct bool) error {
	params := fsrs.DefaultParam()
	f := fsrs.NewFSRS(params)
	rating := fsrs.Good
	if !correct {
		rating = fsrs.Again
	}
	ts := now()
	reviewTime, _ := time.Parse(time.RFC3339, ts)

	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	card, err := loadPuzzleCard(tx, puzzleID)
	if err != nil {
		return err
	}

	stateBefore := int(card.State)
	info := f.Next(card, reviewTime, rating)
	updated := info.Card
	log := info.ReviewLog

	if err := savePuzzleCard(tx, puzzleID, updated); err != nil {
		return fmt.Errorf("save puzzle card: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO srs_puzzle_review_logs
			(puzzle_id, rating, scheduled_days, elapsed_days, reviewed_at, state, state_before)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		puzzleID, int(log.Rating),
		int64(log.ScheduledDays), int64(log.ElapsedDays),
		ts,
		int(updated.State),
		stateBefore,
	); err != nil {
		return fmt.Errorf("insert puzzle review log: %w", err)
	}

	return tx.Commit()
}

// GetPuzzleSummary returns aggregated review statistics since the given time.
func (d *DB) GetPuzzleSummary(since time.Time) (PuzzleSummary, error) {
	sinceStr := since.UTC().Format(time.RFC3339)
	var s PuzzleSummary
	err := d.db.QueryRow(`
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN state_before = 0 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN state_before = 2 AND rating = 1 THEN 1 ELSE 0 END), 0)
		FROM srs_puzzle_review_logs
		WHERE reviewed_at >= ?`, sinceStr,
	).Scan(
		&s.TotalReviewed,
		&s.CorrectCount,
		&s.IncorrectCount,
		&s.NewToLearning,
		&s.LapsedToRelearn,
	)
	if err != nil {
		return PuzzleSummary{}, fmt.Errorf("get puzzle summary: %w", err)
	}
	return s, nil
}

// GetPuzzleCount returns the number of puzzles currently due for review
// (including new puzzles with no SRS entry).
func (d *DB) GetPuzzleCount() (int, error) {
	nowStr := now()
	var count int
	err := d.db.QueryRow(`
		SELECT COUNT(*)
		FROM personal_puzzles p
		LEFT JOIN srs_puzzle_entries e ON e.puzzle_id = p.id
		WHERE e.puzzle_id IS NULL OR e.due <= ?`, nowStr,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("get puzzle count: %w", err)
	}
	return count, nil
}

// GetTacticsLobbyStats returns the statistics shown on the Tactics lobby screen.
func (d *DB) GetTacticsLobbyStats(f PuzzleFilters) (TacticsLobbyStats, error) {
	nowStr := now()
	filterWhere, filterArgs := puzzleFilterWhere(f)
	args := append([]any{nowStr}, filterArgs...)
	var s TacticsLobbyStats
	err := d.db.QueryRow(`
		SELECT COUNT(*),
		       COUNT(CASE WHEN e.puzzle_id IS NULL OR e.due <= ? THEN 1 END)
		FROM personal_puzzles p
		LEFT JOIN srs_puzzle_entries e ON e.puzzle_id = p.id
		WHERE 1=1`+filterWhere, args...,
	).Scan(&s.TotalPuzzles, &s.DueCount)
	if err != nil {
		return TacticsLobbyStats{}, fmt.Errorf("get tactics lobby stats (counts): %w", err)
	}

	err = d.db.QueryRow(`
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END), 0)
		FROM srs_puzzle_review_logs`,
	).Scan(&s.LifetimeTotal, &s.LifetimeCorrect)
	if err != nil {
		return TacticsLobbyStats{}, fmt.Errorf("get tactics lobby stats (lifetime): %w", err)
	}
	return s, nil
}

// GetPuzzleHistory returns a paginated log of reviewed puzzles, most recent first.
func (d *DB) GetPuzzleHistory(limit, offset int) ([]PuzzleHistoryEntry, error) {
	rows, err := d.db.Query(`
		SELECT l.puzzle_id, pp.game_id, pp.fen, pp.classification, pp.player_colour, pp.played_move,
		       l.reviewed_at, l.rating,
		       COALESCE(g.white, ''), COALESCE(g.black, ''), COALESCE(g.date, '')
		FROM srs_puzzle_review_logs l
		JOIN personal_puzzles pp ON pp.id = l.puzzle_id
		LEFT JOIN games g ON g.id = pp.game_id
		ORDER BY l.reviewed_at DESC, l.id DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("get puzzle history: %w", err)
	}
	defer rows.Close()

	var entries []PuzzleHistoryEntry
	for rows.Next() {
		var e PuzzleHistoryEntry
		var rating int
		if err := rows.Scan(
			&e.PuzzleID, &e.GameID, &e.FEN, &e.Classification, &e.PlayerColour, &e.PlayedMove,
			&e.ReviewedAt, &rating,
			&e.White, &e.Black, &e.Date,
		); err != nil {
			return nil, fmt.Errorf("scan puzzle history: %w", err)
		}
		e.Correct = rating == 3
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

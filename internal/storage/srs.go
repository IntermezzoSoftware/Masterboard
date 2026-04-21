package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v4"
)

// DrillScope specifies which repertoires to include in a drill session.
type DrillScope struct {
	Colour         string `json:"colour"`          // "" = all, "white" = white only, "black" = black only
	RepertoireID   string `json:"repertoireId"`    // if non-empty, overrides Colour
	RootMoveID     string `json:"rootMoveId"`      // if non-empty, restrict to subtree rooted here
	IgnoreSchedule bool   `json:"ignoreSchedule"`  // if true, return all moves regardless of due date
}

// DrillMove is one correct player move for a drill card.
type DrillMove struct {
	MoveID  string `json:"moveId"`
	SAN     string `json:"san"`
	UCI     string `json:"uci"`
	ToFEN   string `json:"toFen"`
	Comment string `json:"comment"`
	Nag     *int   `json:"nag"`
}

// SiblingMove is another valid player move at the same position as a DrillCard.
// Due indicates whether that move currently has a due SRS entry.
type SiblingMove struct {
	MoveID string `json:"moveId"`
	SAN    string `json:"san"`
	UCI    string `json:"uci"`
	ToFEN  string `json:"toFen"`
	Due    bool   `json:"due"`
}

// PrecedingMove is the opponent move that led to the DrillCard's position.
type PrecedingMove struct {
	SAN     string `json:"san"`
	UCI     string `json:"uci"`
	FromFEN string `json:"fromFen"`
}

// DrillCard is one quiz item: a position where the player must find a specific move.
// SiblingMoves lists any other valid player moves at the same position.
type DrillCard struct {
	RepertoireID  string         `json:"repertoireId"`
	Colour        string         `json:"colour"` // "white" or "black"
	FromFEN       string         `json:"fromFen"`
	CorrectMove   DrillMove      `json:"correctMove"`
	SiblingMoves  []SiblingMove  `json:"siblingMoves,omitempty"`
	PrecedingMove *PrecedingMove `json:"precedingMove,omitempty"`
}

// fenActiveSide returns "w" or "b" from a FEN string (the active-colour field).
// FEN format: "board turn castling ep halfmove fullmove"
func fenActiveSide(fen string) string {
	i := strings.Index(fen, " ")
	if i < 0 || i+1 >= len(fen) {
		return ""
	}
	return string(fen[i+1])
}

// fenPly returns the half-move (ply) depth of a FEN position.
// Ply = (fullmove - 1) * 2 + (1 if black to move).
func fenPly(fen string) int {
	parts := strings.Fields(fen)
	if len(parts) < 6 {
		return 0
	}
	fullmove, err := strconv.Atoi(parts[5])
	if err != nil || fullmove < 1 {
		return 0
	}
	ply := (fullmove - 1) * 2
	if parts[1] == "b" {
		ply++
	}
	return ply
}

// sqlQuerier is implemented by both *sql.DB and *sql.Tx.
type sqlQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

// loadCard reads a FSRS Card from srs_entries for the given move_id.
// q may be a *sql.DB or *sql.Tx — callers inside a transaction must pass the tx.
// Returns a zero-valued new card if no row exists.
func loadCard(q sqlQuerier, moveID string) (fsrs.Card, error) {
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
		FROM srs_entries WHERE move_id = ?`, moveID,
	).Scan(&due, &stability, &difficulty, &elapsedDays, &scheduledDays, &reps, &lapses, &state, &lastReview)
	if errors.Is(err, sql.ErrNoRows) {
		return fsrs.NewCard(), nil
	}
	if err != nil {
		return fsrs.Card{}, fmt.Errorf("load card %s: %w", moveID, err)
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

// saveCard upserts a FSRS Card into srs_entries for the given move_id.
func saveCard(tx *sql.Tx, moveID string, card fsrs.Card) error {
	dueStr := card.Due.UTC().Format(time.RFC3339)
	var lastReviewStr *string
	if !card.LastReview.IsZero() {
		s := card.LastReview.UTC().Format(time.RFC3339)
		lastReviewStr = &s
	}
	_, err := tx.Exec(`
		INSERT INTO srs_entries (move_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(move_id) DO UPDATE SET
			due            = excluded.due,
			stability      = excluded.stability,
			difficulty     = excluded.difficulty,
			elapsed_days   = excluded.elapsed_days,
			scheduled_days = excluded.scheduled_days,
			reps           = excluded.reps,
			lapses         = excluded.lapses,
			state          = excluded.state,
			last_review    = excluded.last_review`,
		moveID, dueStr,
		card.Stability, card.Difficulty,
		int64(card.ElapsedDays), int64(card.ScheduledDays),
		int64(card.Reps), int64(card.Lapses),
		int64(card.State), lastReviewStr,
	)
	return err
}

// subtreeCTE returns the WITH RECURSIVE prefix clause and the updated args slice
// for filtering to the subtree rooted at rootMoveID.
// If rootMoveID is empty, returns ("", args) unchanged.
func subtreeCTE(rootMoveID string, args []any) (string, []any) {
	if rootMoveID == "" {
		return "", args
	}
	const cte = "WITH RECURSIVE subtree(id) AS (\n" +
		"    SELECT id FROM repertoire_moves WHERE id = ?\n" +
		"    UNION ALL\n" +
		"    SELECT rm2.id FROM repertoire_moves rm2\n" +
		"    JOIN subtree s ON rm2.parent_id = s.id\n" +
		")\n"
	return cte, append([]any{rootMoveID}, args...)
}

// GetDrillSession returns due drill cards for the given scope, shuffled.
// SRS entries are created for any player moves that don't have one yet,
// making them immediately due for their first review.
func (d *DB) GetDrillSession(scope DrillScope) ([]DrillCard, error) {
	cond := "rm.is_transposition = 0"
	args := []any{}
	if scope.RepertoireID != "" {
		cond += " AND rm.repertoire_id = ?"
		args = append(args, scope.RepertoireID)
	} else if scope.Colour != "" {
		cond += " AND r.colour = ?"
		args = append(args, scope.Colour)
	}

	var withClause string
	withClause, args = subtreeCTE(scope.RootMoveID, args)
	if scope.RootMoveID != "" {
		cond += " AND rm.id IN (SELECT id FROM subtree)"
	}

	rows, err := d.db.Query(withClause+`
		SELECT rm.id, rm.repertoire_id, r.colour, rm.from_fen, rm.move_san, rm.move_uci, rm.to_fen,
		       COALESCE(rm.comment, ''), rm.nag
		FROM repertoire_moves rm
		JOIN repertoires r ON r.id = rm.repertoire_id
		WHERE `+cond, args...)
	if err != nil {
		return nil, fmt.Errorf("get drill moves: %w", err)
	}
	defer rows.Close()

	type rawMove struct {
		id, repertoireID, colour, fromFen, moveSan, moveUci, toFen, comment string
		nag                                                                   *int
	}
	var allMoves []rawMove
	for rows.Next() {
		var m rawMove
		if err := rows.Scan(&m.id, &m.repertoireID, &m.colour, &m.fromFen, &m.moveSan, &m.moveUci, &m.toFen, &m.comment, &m.nag); err != nil {
			return nil, fmt.Errorf("scan drill move: %w", err)
		}
		allMoves = append(allMoves, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(allMoves) == 0 {
		return nil, nil
	}

	// Classify moves as player or opponent based on repertoire colour vs FEN turn.
	type posKey struct{ rid, fen string }
	allPlayerMoves := map[posKey][]rawMove{}

	for _, m := range allMoves {
		turn := fenActiveSide(m.fromFen)
		isPlayer := (m.colour == "white" && turn == "w") || (m.colour == "black" && turn == "b")
		if isPlayer {
			key := posKey{m.repertoireID, m.fromFen}
			allPlayerMoves[key] = append(allPlayerMoves[key], m)
		}
	}
	if len(allPlayerMoves) == 0 {
		return nil, nil
	}

	// Collect all player move IDs for bulk operations.
	var allPlayerMoveIDs []string
	for _, moves := range allPlayerMoves {
		for _, m := range moves {
			allPlayerMoveIDs = append(allPlayerMoveIDs, m.id)
		}
	}

	// Ensure SRS entries exist for every player move (idempotent; due immediately on creation).
	nowStr := now()
	for _, id := range allPlayerMoveIDs {
		if _, err := d.db.Exec(
			`INSERT OR IGNORE INTO srs_entries (move_id, due) VALUES (?, ?)`,
			id, nowStr,
		); err != nil {
			return nil, fmt.Errorf("ensure srs entry: %w", err)
		}
	}

	// Build due status map from a single bulk SELECT.
	dueStatus := map[string]bool{} // moveID → isDue
	if scope.IgnoreSchedule {
		for _, id := range allPlayerMoveIDs {
			dueStatus[id] = true
		}
	} else {
		placeholders := strings.Repeat("?,", len(allPlayerMoveIDs))
		placeholders = placeholders[:len(placeholders)-1]
		args := make([]any, len(allPlayerMoveIDs))
		for i, id := range allPlayerMoveIDs {
			args[i] = id
		}
		bulkRows, err := d.db.Query(
			`SELECT move_id, due FROM srs_entries WHERE move_id IN (`+placeholders+`)`,
			args...,
		)
		if err != nil {
			return nil, fmt.Errorf("bulk due query: %w", err)
		}
		defer bulkRows.Close()
		for bulkRows.Next() {
			var moveID, dueAt string
			if err := bulkRows.Scan(&moveID, &dueAt); err != nil {
				return nil, fmt.Errorf("scan due row: %w", err)
			}
			dueStatus[moveID] = dueAt <= nowStr
		}
		if err := bulkRows.Err(); err != nil {
			return nil, err
		}
	}

	// Build one DrillCard per due player move.
	// Each card has a single CorrectMove and SiblingMoves for the other moves at the same position.
	var cards []DrillCard
	for key, moves := range allPlayerMoves {
		for _, m := range moves {
			if !dueStatus[m.id] {
				continue
			}
			card := DrillCard{
				RepertoireID: key.rid,
				Colour:       m.colour,
				FromFEN:      key.fen,
				CorrectMove: DrillMove{
					MoveID:  m.id,
					SAN:     m.moveSan,
					UCI:     m.moveUci,
					ToFEN:   m.toFen,
					Comment: m.comment,
					Nag:     m.nag,
				},
			}
			for _, sibling := range moves {
				if sibling.id == m.id {
					continue
				}
				card.SiblingMoves = append(card.SiblingMoves, SiblingMove{
					MoveID: sibling.id,
					SAN:    sibling.moveSan,
					UCI:    sibling.moveUci,
					ToFEN:  sibling.toFen,
					Due:    dueStatus[sibling.id],
				})
			}
			cards = append(cards, card)
		}
	}

	// Populate PrecedingMove for each card: the opponent move that led to FromFEN.
	for i := range cards {
		var san, uci, fromFen string
		err := d.db.QueryRow(
			`SELECT move_san, move_uci, from_fen FROM repertoire_moves WHERE to_fen = ? AND repertoire_id = ? LIMIT 1`,
			cards[i].FromFEN, cards[i].RepertoireID,
		).Scan(&san, &uci, &fromFen)
		if err == nil {
			cards[i].PrecedingMove = &PrecedingMove{SAN: san, UCI: uci, FromFEN: fromFen}
		}
	}

	// Order cards depth-first: within a branch every ancestor is drilled before
	// its descendants. Across independent branches/trees the starting order is
	// randomised so the user doesn't always begin with the same opening.
	//
	// Build a parent → children index.
	// A card is the parent of another if its CorrectMove.ToFEN matches
	// the child's PrecedingMove.FromFEN (the position the opponent moved from).
	toFenToCard := make(map[string]int, len(cards))
	for i, c := range cards {
		toFenToCard[c.CorrectMove.ToFEN] = i
	}

	children := make([][]int, len(cards))
	isChild := make([]bool, len(cards))
	for i, c := range cards {
		if c.PrecedingMove == nil {
			continue
		}
		parentIdx, ok := toFenToCard[c.PrecedingMove.FromFEN]
		if !ok {
			continue
		}
		children[parentIdx] = append(children[parentIdx], i)
		isChild[i] = true
	}

	// Collect root cards (no due parent) and shuffle for random branch selection.
	roots := make([]int, 0, len(cards))
	for i := range cards {
		if !isChild[i] {
			roots = append(roots, i)
		}
	}
	rand.Shuffle(len(roots), func(i, j int) { roots[i], roots[j] = roots[j], roots[i] })

	// DFS: emit each card before its children; shuffle children for variety.
	ordered := make([]DrillCard, 0, len(cards))
	var dfs func(idx int)
	dfs = func(idx int) {
		ordered = append(ordered, cards[idx])
		ch := children[idx]
		rand.Shuffle(len(ch), func(i, j int) { ch[i], ch[j] = ch[j], ch[i] })
		for _, c := range ch {
			dfs(c)
		}
	}
	for _, r := range roots {
		dfs(r)
	}
	return ordered, nil
}

// GetDrillCount returns the number of drill cards that would be presented for the
// given scope without creating or modifying any SRS entries.
// A move counts as due if it has no SRS entry (never drilled) or its due <= now.
// If scope.IgnoreSchedule is true, all moves in scope are counted.
func (d *DB) GetDrillCount(scope DrillScope) (int, error) {
	cond := "rm.is_transposition = 0"
	args := []any{}
	if scope.RepertoireID != "" {
		cond += " AND rm.repertoire_id = ?"
		args = append(args, scope.RepertoireID)
	} else if scope.Colour != "" {
		cond += " AND r.colour = ?"
		args = append(args, scope.Colour)
	}

	var withClause string
	withClause, args = subtreeCTE(scope.RootMoveID, args)
	if scope.RootMoveID != "" {
		cond += " AND rm.id IN (SELECT id FROM subtree)"
	}

	playerCond := `
		  AND (
		    (r.colour = 'white' AND SUBSTR(rm.from_fen, INSTR(rm.from_fen, ' ') + 1, 1) = 'w')
		    OR (r.colour = 'black' AND SUBSTR(rm.from_fen, INSTR(rm.from_fen, ' ') + 1, 1) = 'b')
		  )`

	var query string
	if scope.IgnoreSchedule {
		query = withClause + `
			SELECT COUNT(*)
			FROM repertoire_moves rm
			JOIN repertoires r ON r.id = rm.repertoire_id
			WHERE ` + cond + playerCond
	} else {
		nowStr := now()
		args = append(args, nowStr)
		query = withClause + `
			SELECT COUNT(*)
			FROM repertoire_moves rm
			JOIN repertoires r ON r.id = rm.repertoire_id
			LEFT JOIN srs_entries se ON se.move_id = rm.id
			WHERE ` + cond + playerCond + `
			  AND (se.move_id IS NULL OR se.due <= ?)`
	}

	var count int
	if err := d.db.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("get drill count: %w", err)
	}
	return count, nil
}

// ResetDrillScope resets SRS progress for all player moves matching the scope by
// deleting their srs_entries rows. They will be recreated as fresh FSRS cards on
// the next GetDrillSession call, making them immediately due.
func (d *DB) ResetDrillScope(scope DrillScope) error {
	cond := "rm.is_transposition = 0"
	args := []any{}
	if scope.RepertoireID != "" {
		cond += " AND rm.repertoire_id = ?"
		args = append(args, scope.RepertoireID)
	} else if scope.Colour != "" {
		cond += " AND r.colour = ?"
		args = append(args, scope.Colour)
	}

	var withClause string
	withClause, args = subtreeCTE(scope.RootMoveID, args)
	if scope.RootMoveID != "" {
		cond += " AND rm.id IN (SELECT id FROM subtree)"
	}

	_, err := d.db.Exec(withClause+`
		DELETE FROM srs_entries WHERE move_id IN (
			SELECT rm.id FROM repertoire_moves rm
			JOIN repertoires r ON r.id = rm.repertoire_id
			WHERE `+cond+`
		)`, args...)
	if err != nil {
		return fmt.Errorf("reset drill scope: %w", err)
	}
	return nil
}

// DrillSummary aggregates review-log statistics for a completed drill session.
type DrillSummary struct {
	TotalReviewed   int `json:"totalReviewed"`
	CorrectCount    int `json:"correctCount"`
	IncorrectCount  int `json:"incorrectCount"`
	NewToLearning   int `json:"newToLearning"`   // cards that were New and got promoted
	LapsedToRelearn int `json:"lapsedToRelearn"` // cards that transitioned to Relearning(3)
}

// GetDrillSummary returns aggregated statistics for all reviews recorded since the
// given time. It queries srs_review_logs for rows where reviewed_at >= since.
func (d *DB) GetDrillSummary(since time.Time) (DrillSummary, error) {
	sinceStr := since.UTC().Format(time.RFC3339)
	rows, err := d.db.Query(`
		SELECT rating, state, state_before
		FROM srs_review_logs
		WHERE reviewed_at >= ?`, sinceStr)
	if err != nil {
		return DrillSummary{}, fmt.Errorf("get drill summary: %w", err)
	}
	defer rows.Close()

	var s DrillSummary
	for rows.Next() {
		var rating, state, stateBefore int
		if err := rows.Scan(&rating, &state, &stateBefore); err != nil {
			return DrillSummary{}, fmt.Errorf("scan drill summary row: %w", err)
		}
		s.TotalReviewed++
		if rating == 3 { // Good
			s.CorrectCount++
		} else if rating == 1 { // Again
			s.IncorrectCount++
		}
		// New card promoted: pre-review state was New(0) and post-review state is Learning(1) or Review(2)
		if stateBefore == 0 && (state == 1 || state == 2) {
			s.NewToLearning++
		}
		// Lapsed to relearning
		if state == 3 {
			s.LapsedToRelearn++
		}
	}
	if err := rows.Err(); err != nil {
		return DrillSummary{}, err
	}
	return s, nil
}

// HeatmapEntry holds retrievability data for one player move.
type HeatmapEntry struct {
	MoveID         string  `json:"moveId"`
	Retrievability float64 `json:"retrievability"` // 0.0–1.0; 0 if State=New
	State          int     `json:"state"`           // 0=New, 1=Learning, 2=Review, 3=Relearning
}

// GetRepertoireHeatmap returns heatmap entries for all player moves in a repertoire.
// Moves with no SRS entry (never drilled) are returned with Retrievability=0, State=0.
func (d *DB) GetRepertoireHeatmap(repertoireID string) ([]HeatmapEntry, error) {
	rows, err := d.db.Query(`
		SELECT rm.id,
		       se.due, se.stability, se.difficulty, se.elapsed_days,
		       se.scheduled_days, se.reps, se.lapses, se.state, se.last_review
		FROM repertoire_moves rm
		JOIN repertoires r ON r.id = rm.repertoire_id
		LEFT JOIN srs_entries se ON se.move_id = rm.id
		WHERE rm.repertoire_id = ?
		  AND rm.is_transposition = 0
		  AND (
		    (r.colour = 'white' AND SUBSTR(rm.from_fen, INSTR(rm.from_fen, ' ') + 1, 1) = 'w')
		    OR (r.colour = 'black' AND SUBSTR(rm.from_fen, INSTR(rm.from_fen, ' ') + 1, 1) = 'b')
		  )`, repertoireID)
	if err != nil {
		return nil, fmt.Errorf("get repertoire heatmap: %w", err)
	}
	defer rows.Close()

	params := fsrs.DefaultParam()
	f := fsrs.NewFSRS(params)
	now := time.Now().UTC()

	var entries []HeatmapEntry
	for rows.Next() {
		var moveID string
		var due, lastReview sql.NullString
		var stability, difficulty sql.NullFloat64
		var elapsedDays, scheduledDays, reps, lapses, state sql.NullInt64

		if err := rows.Scan(
			&moveID,
			&due, &stability, &difficulty, &elapsedDays,
			&scheduledDays, &reps, &lapses, &state, &lastReview,
		); err != nil {
			return nil, fmt.Errorf("scan heatmap row: %w", err)
		}

		if !due.Valid {
			// No SRS entry — never drilled
			entries = append(entries, HeatmapEntry{MoveID: moveID, Retrievability: 0, State: 0})
			continue
		}

		card := fsrs.Card{
			Stability:     stability.Float64,
			Difficulty:    difficulty.Float64,
			ElapsedDays:   uint64(elapsedDays.Int64),
			ScheduledDays: uint64(scheduledDays.Int64),
			Reps:          uint64(reps.Int64),
			Lapses:        uint64(lapses.Int64),
			State:         fsrs.State(state.Int64),
		}
		if t, err := time.Parse(time.RFC3339, due.String); err == nil {
			card.Due = t
		}
		if lastReview.Valid {
			if t, err := time.Parse(time.RFC3339, lastReview.String); err == nil {
				card.LastReview = t
			}
		}

		retrievability := f.GetRetrievability(card, now)
		entries = append(entries, HeatmapEntry{
			MoveID:         moveID,
			Retrievability: retrievability,
			State:          int(card.State),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

// RecordDrillResult updates FSRS state for a set of move IDs after a drill answer.
// correct=true maps to fsrs.Good (rating 3); correct=false maps to fsrs.Again (rating 1).
// playedUCI is the UCI string of the move the player actually played (stored in
// srs_review_logs for incorrect answers; pass "" or any value for correct answers,
// it will be stored as NULL).
func (d *DB) RecordDrillResult(moveIDs []string, correct bool, playedUCI string) error {
	params := fsrs.DefaultParam()
	f := fsrs.NewFSRS(params)
	rating := fsrs.Good
	if !correct {
		rating = fsrs.Again
	}
	reviewTime := time.Now().UTC()

	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	for _, id := range moveIDs {
		card, err := loadCard(tx, id)
		if err != nil {
			return err
		}

		info := f.Next(card, reviewTime, rating)
		updated := info.Card
		log := info.ReviewLog

		if err := saveCard(tx, id, updated); err != nil {
			return fmt.Errorf("save card %s: %w", id, err)
		}

		var playedUCIVal *string
		if !correct && playedUCI != "" {
			playedUCIVal = &playedUCI
		}
		if _, err := tx.Exec(`
			INSERT INTO srs_review_logs (move_id, rating, scheduled_days, elapsed_days, reviewed_at, state, played_uci, state_before)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, int(log.Rating),
			int64(log.ScheduledDays), int64(log.ElapsedDays),
			now(),
			int(updated.State),
			playedUCIVal,
			int(log.State),
		); err != nil {
			return fmt.Errorf("insert review log %s: %w", id, err)
		}
	}

	return tx.Commit()
}

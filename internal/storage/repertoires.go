package storage

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// ListRepertoires returns all repertoires ordered by colour then name.
func (d *DB) ListRepertoires() ([]repertoire.Repertoire, error) {
	rows, err := d.db.Query(`
		SELECT id, name, colour, description
		FROM repertoires
		ORDER BY colour, name`)
	if err != nil {
		return nil, fmt.Errorf("list repertoires: %w", err)
	}
	defer rows.Close()

	var result []repertoire.Repertoire
	for rows.Next() {
		var r repertoire.Repertoire
		if err := rows.Scan(&r.ID, &r.Name, &r.Colour, &r.Description); err != nil {
			return nil, fmt.Errorf("scan repertoire: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetRepertoire returns a single repertoire by ID.
func (d *DB) GetRepertoire(id string) (*repertoire.Repertoire, error) {
	var r repertoire.Repertoire
	err := d.db.QueryRow(`
		SELECT id, name, colour, description
		FROM repertoires WHERE id = ?`, id).
		Scan(&r.ID, &r.Name, &r.Colour, &r.Description)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get repertoire: %w", err)
	}
	return &r, nil
}

// CreateRepertoire inserts a new repertoire and returns its UUID.
func (d *DB) CreateRepertoire(name, colour string) (string, error) {
	id := uuid.New().String()
	_, err := d.db.Exec(`
		INSERT INTO repertoires (id, name, colour)
		VALUES (?, ?, ?)`, id, name, colour)
	if err != nil {
		return "", fmt.Errorf("create repertoire: %w", err)
	}
	return id, nil
}

// RenameRepertoire changes the name of a repertoire.
func (d *DB) RenameRepertoire(id, name string) error {
	res, err := d.db.Exec(`
		UPDATE repertoires SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
		WHERE id = ?`, name, id)
	if err != nil {
		return fmt.Errorf("rename repertoire: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteRepertoire removes a repertoire and cascades to its moves.
func (d *DB) DeleteRepertoire(id string) error {
	res, err := d.db.Exec(`DELETE FROM repertoires WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete repertoire: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// LoadRepertoireMoves returns all moves for a repertoire ordered by move_order.
func (d *DB) LoadRepertoireMoves(repertoireID string) ([]repertoire.RepertoireMove, error) {
	rows, err := d.db.Query(`
		SELECT id, repertoire_id, parent_id, from_fen, to_fen,
		       move_san, move_uci, move_order, nag, comment, shapes, is_transposition
		FROM repertoire_moves
		WHERE repertoire_id = ?
		ORDER BY move_order`, repertoireID)
	if err != nil {
		return nil, fmt.Errorf("load repertoire moves: %w", err)
	}
	defer rows.Close()
	return scanMoves(rows)
}

// GetMovesForPosition returns moves from a specific position within a repertoire.
func (d *DB) GetMovesForPosition(repertoireID, fromFEN string) ([]repertoire.RepertoireMove, error) {
	rows, err := d.db.Query(`
		SELECT id, repertoire_id, parent_id, from_fen, to_fen,
		       move_san, move_uci, move_order, nag, comment, shapes, is_transposition
		FROM repertoire_moves
		WHERE repertoire_id = ? AND from_fen = ?
		ORDER BY move_order`, repertoireID, fromFEN)
	if err != nil {
		return nil, fmt.Errorf("get moves for position: %w", err)
	}
	defer rows.Close()
	return scanMoves(rows)
}

// SaveRepertoireMove inserts a new move node and returns its UUID.
// If the move's destination position is already reached by another move in this
// repertoire (same position via a different move order), the move is stored with
// is_transposition = 1.  Comparison uses repertoire.PositionFen() so routes that
// reach the same board position via different halfmove-clock values are recognised
// as transpositions.
func (d *DB) SaveRepertoireMove(m repertoire.RepertoireMove) (string, error) {
	// Detect transposition: does another move already reach this same destination position?
	posKey := repertoire.PositionFen(m.ToFEN)
	var count int
	if err := d.db.QueryRow(`
		SELECT COUNT(*) FROM repertoire_moves
		WHERE repertoire_id = ? AND (to_fen = ? OR to_fen LIKE ? || ' %')`,
		m.RepertoireID, posKey, posKey).Scan(&count); err != nil {
		return "", fmt.Errorf("check transposition: %w", err)
	}
	isTransposition := count > 0

	id := uuid.New().String()
	_, err := d.db.Exec(`
		INSERT INTO repertoire_moves
		  (id, repertoire_id, parent_id, from_fen, to_fen,
		   move_san, move_uci, move_order, nag, comment, shapes, is_transposition)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, m.RepertoireID, m.ParentID, m.FromFEN, m.ToFEN,
		m.MoveSAN, m.MoveUCI, m.MoveOrder, m.NAG, m.Comment, m.Shapes, isTransposition)
	if err != nil {
		return "", fmt.Errorf("save repertoire move: %w", err)
	}
	return id, nil
}

// UpdateRepertoireMove updates the mutable fields (nag, comment, shapes, move_order) of an existing move.
func (d *DB) UpdateRepertoireMove(m repertoire.RepertoireMove) error {
	res, err := d.db.Exec(`
		UPDATE repertoire_moves
		SET nag = ?, comment = ?, shapes = ?, move_order = ?
		WHERE id = ?`,
		m.NAG, m.Comment, m.Shapes, m.MoveOrder, m.ID)
	if err != nil {
		return fmt.Errorf("update repertoire move: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReorderUpdate specifies a new move_order value for a single move.
type ReorderUpdate struct {
	ID       string `json:"id"`
	NewOrder int    `json:"newOrder"`
}

// BatchReorderMoves updates move_order for a set of moves in a single transaction.
func (d *DB) BatchReorderMoves(updates []ReorderUpdate) error {
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("batch reorder: begin: %w", err)
	}
	for _, u := range updates {
		if _, err := tx.Exec(
			`UPDATE repertoire_moves SET move_order = ? WHERE id = ?`,
			u.NewOrder, u.ID,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("batch reorder %s: %w", u.ID, err)
		}
	}
	return tx.Commit()
}

// DeleteRepertoireBranch removes a move and all its descendants (via FK cascade).
func (d *DB) DeleteRepertoireBranch(moveID string) error {
	res, err := d.db.Exec(`DELETE FROM repertoire_moves WHERE id = ?`, moveID)
	if err != nil {
		return fmt.Errorf("delete repertoire branch: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// scanMoves reads RepertoireMove rows from an open *sql.Rows cursor.
func scanMoves(rows *sql.Rows) ([]repertoire.RepertoireMove, error) {
	var result []repertoire.RepertoireMove
	for rows.Next() {
		var m repertoire.RepertoireMove
		if err := rows.Scan(
			&m.ID, &m.RepertoireID, &m.ParentID,
			&m.FromFEN, &m.ToFEN, &m.MoveSAN, &m.MoveUCI,
			&m.MoveOrder, &m.NAG, &m.Comment, &m.Shapes, &m.IsTransposition,
		); err != nil {
			return nil, fmt.Errorf("scan repertoire move: %w", err)
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

// scanPositionSummaries reads rows produced by a JOIN of repertoires and repertoire_moves,
// grouping moves under their parent repertoire, preserving the ORDER BY ordering.
// Expected column order: r.id, r.name, r.colour, r.description,
//                        m.id, m.repertoire_id, m.parent_id, m.from_fen, m.to_fen,
//                        m.move_san, m.move_uci, m.move_order, m.nag, m.comment, m.shapes, m.is_transposition
func scanPositionSummaries(rows *sql.Rows) ([]repertoire.RepertoireData, error) {
	defer rows.Close()
	byID := map[string]*repertoire.RepertoireData{}
	order := []string{}
	for rows.Next() {
		var r repertoire.Repertoire
		var m repertoire.RepertoireMove
		if err := rows.Scan(
			&r.ID, &r.Name, &r.Colour, &r.Description,
			&m.ID, &m.RepertoireID, &m.ParentID,
			&m.FromFEN, &m.ToFEN, &m.MoveSAN, &m.MoveUCI,
			&m.MoveOrder, &m.NAG, &m.Comment, &m.Shapes, &m.IsTransposition,
		); err != nil {
			return nil, fmt.Errorf("scan position summary: %w", err)
		}
		if _, seen := byID[r.ID]; !seen {
			byID[r.ID] = &repertoire.RepertoireData{Repertoire: r}
			order = append(order, r.ID)
		}
		byID[r.ID].Moves = append(byID[r.ID].Moves, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan position summary rows: %w", err)
	}
	result := make([]repertoire.RepertoireData, 0, len(order))
	for _, id := range order {
		result = append(result, *byID[id])
	}
	return result, nil
}

// migrateTranspositionFlags recomputes is_transposition for every repertoire move
// using repertoire.PositionFen(), so routes that reach the same board position via
// different halfmove-clock values are treated as transpositions.  Within each
// (repertoire_id, position-key) group the earliest-created move is canonical
// (is_transposition = 0); all others are transpositions (is_transposition = 1).
// This is idempotent and replaces the earlier SQL-only cleanup/backfill passes.
func migrateTranspositionFlags(db *sql.DB) error {
	rows, err := db.Query(`
		SELECT id, repertoire_id, to_fen, created_at, is_transposition
		FROM repertoire_moves
		ORDER BY created_at, id`)
	if err != nil {
		return fmt.Errorf("query moves: %w", err)
	}
	defer rows.Close()

	type row struct {
		id, repID, toFen string
		isTransposition  bool
	}
	type groupKey struct{ repID, posKey string }

	canonical := map[groupKey]string{} // first id seen per (repID, posKey)
	var all []row
	for rows.Next() {
		var r row
		var trans int
		var createdAt string
		if err := rows.Scan(&r.id, &r.repID, &r.toFen, &createdAt, &trans); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		r.isTransposition = trans != 0
		all = append(all, r)
		key := groupKey{r.repID, repertoire.PositionFen(r.toFen)}
		if _, seen := canonical[key]; !seen {
			canonical[key] = r.id
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, r := range all {
		key := groupKey{r.repID, repertoire.PositionFen(r.toFen)}
		want := canonical[key] != r.id
		if r.isTransposition == want {
			continue
		}
		val := 0
		if want {
			val = 1
		}
		if _, err := db.Exec(`UPDATE repertoire_moves SET is_transposition = ? WHERE id = ?`, val, r.id); err != nil {
			return fmt.Errorf("update %s: %w", r.id, err)
		}
	}
	return nil
}

// GetAllMovesForPosition returns all repertoire moves prepared from `fen`, grouped by
// repertoire, regardless of colour. Sorting by orientation is handled client-side.
func (d *DB) GetAllMovesForPosition(fen string) ([]repertoire.RepertoireData, error) {
	rows, err := d.db.Query(`
		SELECT r.id, r.name, r.colour, r.description,
		       m.id, m.repertoire_id, m.parent_id, m.from_fen, m.to_fen,
		       m.move_san, m.move_uci, m.move_order, m.nag, m.comment, m.shapes, m.is_transposition
		FROM repertoire_moves m
		JOIN repertoires r ON r.id = m.repertoire_id
		WHERE m.from_fen = ?
		ORDER BY r.colour, r.name, m.move_order`, fen)
	if err != nil {
		return nil, fmt.Errorf("get all moves for position: %w", err)
	}
	return scanPositionSummaries(rows)
}

// BatchSaveRepertoireMoves inserts a slice of moves in a single transaction.
// Moves must be ordered depth-first (parents before children).
// Pre-loads existing position keys and sibling counts for correct transposition
// detection and move ordering when adding to an existing repertoire.
func (d *DB) BatchSaveRepertoireMoves(moves []repertoire.RepertoireMove) (int, error) {
	if len(moves) == 0 {
		return 0, nil
	}
	repertoireID := moves[0].RepertoireID

	existingPos := map[string]struct{}{}
	rows, err := d.db.Query(
		`SELECT to_fen FROM repertoire_moves WHERE repertoire_id = ?`, repertoireID)
	if err != nil {
		return 0, fmt.Errorf("batch save: load existing positions: %w", err)
	}
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			rows.Close()
			return 0, err
		}
		existingPos[repertoire.PositionFen(f)] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	siblingCounts := map[string]int{}
	rows2, err := d.db.Query(
		`SELECT from_fen, COUNT(*) FROM repertoire_moves WHERE repertoire_id = ? GROUP BY from_fen`,
		repertoireID)
	if err != nil {
		return 0, fmt.Errorf("batch save: load sibling counts: %w", err)
	}
	for rows2.Next() {
		var f string
		var c int
		if err := rows2.Scan(&f, &c); err != nil {
			rows2.Close()
			return 0, err
		}
		siblingCounts[repertoire.PositionFen(f)] = c
	}
	rows2.Close()
	if err := rows2.Err(); err != nil {
		return 0, err
	}

	tx, err := d.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("batch save: begin: %w", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO repertoire_moves
		  (id, repertoire_id, parent_id, from_fen, to_fen,
		   move_san, move_uci, move_order, nag, comment, shapes, is_transposition)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return 0, fmt.Errorf("batch save: prepare: %w", err)
	}
	defer stmt.Close()

	inserted := 0
	for _, m := range moves {
		posKey := repertoire.PositionFen(m.ToFEN)
		_, isTransposition := existingPos[posKey]
		existingPos[posKey] = struct{}{}

		fromKey := repertoire.PositionFen(m.FromFEN)
		m.MoveOrder += siblingCounts[fromKey]
		siblingCounts[fromKey]++

		if _, err := stmt.Exec(
			m.ID, m.RepertoireID, m.ParentID, m.FromFEN, m.ToFEN,
			m.MoveSAN, m.MoveUCI, m.MoveOrder, m.NAG, m.Comment, m.Shapes,
			boolToInt(isTransposition),
		); err != nil {
			_ = tx.Rollback()
			return inserted, fmt.Errorf("batch save move %s: %w", m.MoveSAN, err)
		}
		inserted++
	}

	return inserted, tx.Commit()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

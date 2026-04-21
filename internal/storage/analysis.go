package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
)

// UpsertGameAnalysis creates or updates the analysis record for a game.
// On conflict (re-analysis), only status and depth are updated — existing
// result columns are left intact so they can be restored if analysis is cancelled.
func (d *DB) UpsertGameAnalysis(gameID string, depth int, status string) error {
	ts := now()
	_, err := d.db.Exec(`
		INSERT INTO game_analyses (game_id, depth, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(game_id) DO UPDATE SET
			depth      = excluded.depth,
			status     = excluded.status,
			updated_at = excluded.updated_at`,
		gameID, depth, status, ts, ts,
	)
	if err != nil {
		return fmt.Errorf("upsert game_analyses: %w", err)
	}
	return nil
}

// UpdateAnalysisStatus updates the status (and optionally error message) of an analysis.
func (d *DB) UpdateAnalysisStatus(gameID, status, errorMsg string) error {
	ts := now()
	_, err := d.db.Exec(`
		UPDATE game_analyses SET status = ?, error_msg = ?, updated_at = ?
		WHERE game_id = ?`,
		status, nullString(errorMsg), ts, gameID,
	)
	if err != nil {
		return fmt.Errorf("update analysis status: %w", err)
	}
	return nil
}

// CompleteAnalysis marks an analysis as complete with accuracy, ACPL scores,
// and per-move evaluations stored as JSON.
func (d *DB) CompleteAnalysis(gameID string, whiteAcc, blackAcc, whiteACPL, blackACPL float64, evals []analysis.MoveEval) error {
	ts := now()

	var evalsJSON []byte
	if len(evals) > 0 {
		var err error
		evalsJSON, err = json.Marshal(evals)
		if err != nil {
			return fmt.Errorf("marshal evals: %w", err)
		}
	}

	_, err := d.db.Exec(`
		UPDATE game_analyses
		SET status = 'complete',
		    white_accuracy = ?, black_accuracy = ?,
		    white_acpl = ?, black_acpl = ?,
		    evals = ?,
		    analysed_at = ?, updated_at = ?
		WHERE game_id = ?`,
		whiteAcc, blackAcc, whiteACPL, blackACPL,
		nullBytes(evalsJSON),
		ts, ts, gameID,
	)
	if err != nil {
		return fmt.Errorf("complete analysis: %w", err)
	}
	return nil
}

// MarkPgnAnnotated sets the pgn_annotated flag to true and records the evals
// that were baked into the PGN, so future re-annotations can surgically replace
// only the analysis-written portions rather than overwriting user edits.
func (d *DB) MarkPgnAnnotated(gameID string, appliedEvals []analysis.MoveEval) error {
	ts := now()

	var appliedJSON []byte
	if len(appliedEvals) > 0 {
		var err error
		appliedJSON, err = json.Marshal(appliedEvals)
		if err != nil {
			return fmt.Errorf("marshal applied evals: %w", err)
		}
	}

	_, err := d.db.Exec(`
		UPDATE game_analyses SET pgn_annotated = 1, applied_evals = ?, updated_at = ?
		WHERE game_id = ?`, nullBytes(appliedJSON), ts, gameID)
	if err != nil {
		return fmt.Errorf("mark pgn annotated: %w", err)
	}
	return nil
}

// GetGameAnalysis returns the full analysis result for a game, or nil if none exists.
func (d *DB) GetGameAnalysis(gameID string) (*analysis.GameAnalysisResult, error) {
	row := d.db.QueryRow(`
		SELECT game_id, depth, white_accuracy, black_accuracy, white_acpl, black_acpl,
		       status, error_msg, analysed_at, evals, pgn_annotated, applied_evals
		FROM game_analyses WHERE game_id = ?`, gameID)

	var rec analysis.AnalysisRecord
	var errMsg sql.NullString
	var analysedAt sql.NullString
	var whiteAcc, blackAcc, whiteACPL, blackACPL sql.NullFloat64
	var evalsJSON sql.NullString
	var appliedEvalsJSON sql.NullString
	var pgnAnnotated int

	err := row.Scan(
		&rec.GameID, &rec.Depth,
		&whiteAcc, &blackAcc, &whiteACPL, &blackACPL,
		&rec.Status, &errMsg, &analysedAt, &evalsJSON, &pgnAnnotated, &appliedEvalsJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get game analysis: %w", err)
	}

	if whiteAcc.Valid {
		rec.WhiteAccuracy = &whiteAcc.Float64
	}
	if blackAcc.Valid {
		rec.BlackAccuracy = &blackAcc.Float64
	}
	if whiteACPL.Valid {
		rec.WhiteACPL = &whiteACPL.Float64
	}
	if blackACPL.Valid {
		rec.BlackACPL = &blackACPL.Float64
	}
	rec.ErrorMsg = errMsg.String
	rec.AnalysedAt = analysedAt.String
	rec.PgnAnnotated = pgnAnnotated != 0

	result := &analysis.GameAnalysisResult{AnalysisRecord: rec}

	if evalsJSON.Valid && evalsJSON.String != "" {
		if err := json.Unmarshal([]byte(evalsJSON.String), &result.Evals); err != nil {
			return nil, fmt.Errorf("unmarshal evals: %w", err)
		}
	}
	if result.Evals == nil {
		result.Evals = []analysis.MoveEval{}
	}

	if appliedEvalsJSON.Valid && appliedEvalsJSON.String != "" {
		if err := json.Unmarshal([]byte(appliedEvalsJSON.String), &result.AppliedEvals); err != nil {
			return nil, fmt.Errorf("unmarshal applied evals: %w", err)
		}
	}
	if result.AppliedEvals == nil {
		result.AppliedEvals = []analysis.MoveEval{}
	}

	return result, nil
}

// ResetStaleAnalyses marks any analyses stuck in 'pending' or 'running' as
// 'error'. This handles the case where the app was shut down or crashed while
// analysis was in progress. Returns the number of affected rows.
func (d *DB) ResetStaleAnalyses() (int64, error) {
	ts := now()
	res, err := d.db.Exec(`
		UPDATE game_analyses
		SET status = 'error', error_msg = 'interrupted by app restart', updated_at = ?
		WHERE status IN ('pending', 'running')`, ts)
	if err != nil {
		return 0, fmt.Errorf("reset stale analyses: %w", err)
	}
	return res.RowsAffected()
}

// CancelActiveAnalyses cancels all 'pending' or 'running' analysis records
// and returns the affected game IDs.
// Records that have existing results (re-analyses) are restored to 'complete'
// so the previous results are preserved. Records with no prior results are deleted.
func (d *DB) CancelActiveAnalyses() ([]string, error) {
	rows, err := d.db.Query(`SELECT game_id FROM game_analyses WHERE status IN ('pending', 'running')`)
	if err != nil {
		return nil, fmt.Errorf("query active analyses: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan game_id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}

	ts := now()
	// Re-analyses: restore to 'complete' so previous results are preserved.
	_, err = d.db.Exec(`
		UPDATE game_analyses SET status = 'complete', updated_at = ?
		WHERE status IN ('pending', 'running') AND evals IS NOT NULL`, ts)
	if err != nil {
		return nil, fmt.Errorf("restore re-analyses: %w", err)
	}
	// Fresh analyses: delete the record entirely (no prior results to preserve).
	_, err = d.db.Exec(`DELETE FROM game_analyses WHERE status IN ('pending', 'running') AND evals IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("delete fresh analyses: %w", err)
	}
	return ids, nil
}

// DeleteGameAnalysis removes the analysis record for a game.
func (d *DB) DeleteGameAnalysis(gameID string) error {
	_, err := d.db.Exec(`DELETE FROM game_analyses WHERE game_id = ?`, gameID)
	if err != nil {
		return fmt.Errorf("delete analysis: %w", err)
	}
	return nil
}

// nullBytes returns a sql.NullString from a byte slice (nil → NULL).
func nullBytes(b []byte) sql.NullString {
	if b == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: string(b), Valid: true}
}

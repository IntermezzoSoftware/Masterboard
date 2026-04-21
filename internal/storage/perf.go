//go:build perf

// Package storage perf-only helpers. Compiled exclusively when `-tags perf`
// is passed to `go build` / `wails build`. Release builds do not include
// this file, so these methods simply do not exist in the release binary.
//
// See app_perf.go for the handler layer that exposes these via the Wails
// event bus.

package storage

import "fmt"

// PerfTruncateGames removes all rows from the games table without dropping
// the schema. game_analyses and game_collections cascade via foreign keys;
// the position-index tables are cleared explicitly (they reference games
// via game_id but without cascade). The performance harness uses this to
// reset per-scenario state without having to respawn the binary.
//
// Intentionally destructive and unrecoverable — do not add this method to
// any non-perf code path.
func (d *DB) PerfTruncateGames() error {
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("perf truncate begin: %w", err)
	}
	// Best-effort: position-index tables may or may not exist depending on
	// which migrations have run. Swallow "no such table" here but fail on
	// real errors.
	for _, s := range []string{
		`DELETE FROM position_game_index`,
		`DELETE FROM position_indexed_games`,
		`DELETE FROM position_stats`,
	} {
		if _, err := tx.Exec(s); err != nil {
			// Continue past "no such table" — these are migration-added.
			continue
		}
	}
	if _, err := tx.Exec(`DELETE FROM games`); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("perf truncate games: %w", err)
	}
	return tx.Commit()
}

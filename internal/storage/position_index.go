package storage

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"strconv"
	"strings"

	chess "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
	"github.com/IntermezzoSoftware/Masterboard/internal/game"
	"github.com/IntermezzoSoftware/Masterboard/internal/masterdb"
)

// PersonalMoveStat holds aggregated result statistics for one candidate move
// from a given position in the personal game collection.
// WhiteWins and BlackWins are always from white's perspective.
type PersonalMoveStat struct {
	MoveSAN     string  `json:"moveSan"`
	WhiteWins   int     `json:"whiteWins"`
	Draws       int     `json:"draws"`
	BlackWins   int     `json:"blackWins"`
	AvgElo      int     `json:"avgElo"`      // 0 if no Elo data available
	Total       int     `json:"total"`       // WhiteWins + Draws + BlackWins
	AvgAccuracy float64 `json:"avgAccuracy"` // 0 if no analysis data
}

// PersonalGameSummary is a lightweight game record returned by GetPersonalGamesAtPosition.
type PersonalGameSummary struct {
	ID          string `json:"id"`
	White       string `json:"white"`
	Black       string `json:"black"`
	Result      string `json:"result"`
	Date        string `json:"date"`
	WhiteElo    *int   `json:"whiteElo"`
	BlackElo    *int   `json:"blackElo"`
	TimeControl string `json:"timeControl"`
	MoveSAN     string `json:"moveSan"` // move played from this position in this game
}

// PositionFilters holds optional filters for personal position queries.
// All fields are optional — empty string / nil means no filter.
type PositionFilters struct {
	FolderID     string
	CollectionID string
	PlayerName   string   // case-insensitive substring match on white or black name
	PlayerNames  []string // exact case-insensitive OR match (used for "Myself" multi-identity)
	PlayerSide   string   // "white", "black", or "" (either side)
	SortBy       string   // "elo" (default) or "date"
	DateFrom     string   // "YYYY-MM-DD"; games stored as "YYYY.MM.DD[...]" — converted for comparison
	DateTo       string   // "YYYY-MM-DD" inclusive upper bound
}

// sqlExecer is the minimal interface satisfied by both *sql.DB and *sql.Tx.
type sqlExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

// indexGame indexes a single game into position_stats and position_game_index.
// It does NOT insert into position_indexed_games — the caller does that after
// successfully committing the transaction.
//
// db may be a *sql.DB or *sql.Tx.
func indexGame(db sqlExecer, gameID, pgn string) error {
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		return fmt.Errorf("parse PGN: %w", err)
	}
	g := chess.NewGame()
	updateFn(g)

	moves := g.Moves()
	positions := g.Positions()
	if len(moves) == 0 {
		return nil
	}

	// Determine result from PGN header.
	result := game.ExtractHeader(pgn, "Result")
	var wins, draws, losses int
	switch result {
	case "1-0":
		wins = 1
	case "0-1":
		losses = 1
	case "1/2-1/2":
		draws = 1
	}

	// Parse Elo tags.
	var avgElo, eloCount int
	whiteEloStr := game.ExtractHeader(pgn, "WhiteElo")
	blackEloStr := game.ExtractHeader(pgn, "BlackElo")
	if w, err1 := strconv.Atoi(whiteEloStr); err1 == nil && w > 0 {
		if b, err2 := strconv.Atoi(blackEloStr); err2 == nil && b > 0 {
			avgElo = (w + b) / 2
			eloCount = 1
		}
	}

	an := chess.AlgebraicNotation{}

	for i, move := range moves {
		pos := positions[i]
		hash, herr := masterdb.HashFEN(pos.String())
		if herr != nil {
			continue // skip positions with invalid FEN (should not happen)
		}
		san := an.Encode(pos, move)

		if _, err := db.Exec(`
			INSERT INTO position_stats (position_hash, move_san, wins, draws, losses, total_elo, elo_count)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(position_hash, move_san) DO UPDATE SET
				wins      = wins      + excluded.wins,
				draws     = draws     + excluded.draws,
				losses    = losses    + excluded.losses,
				total_elo = total_elo + excluded.total_elo,
				elo_count = elo_count + excluded.elo_count`,
			hash, san, wins, draws, losses, avgElo*eloCount, eloCount,
		); err != nil {
			return fmt.Errorf("upsert position_stats: %w", err)
		}

		if i < masterdb.GameIndexMaxPly {
			if _, err := db.Exec(`
				INSERT OR IGNORE INTO position_game_index (position_hash, game_id, move_san)
				VALUES (?, ?, ?)`,
				hash, gameID, san,
			); err != nil {
				return fmt.Errorf("insert position_game_index: %w", err)
			}
		}
	}
	return nil
}

// IndexGame indexes a single game by ID into the position tables.
// If the game has already been indexed, it is a no-op.
// Indexing failure is logged but must never prevent game saves — callers
// should log and swallow the error rather than propagating it.
func (d *DB) IndexGame(gameID string) error {
	// Fast check: already indexed?
	var exists int
	if err := d.db.QueryRow(
		`SELECT 1 FROM position_indexed_games WHERE game_id = ?`, gameID,
	).Scan(&exists); err == nil {
		return nil // already indexed
	}

	var pgn string
	if err := d.db.QueryRow(
		`SELECT pgn FROM games WHERE id = ?`, gameID,
	).Scan(&pgn); err != nil {
		return fmt.Errorf("fetch game %s: %w", gameID, err)
	}

	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	if err := indexGame(tx, gameID, pgn); err != nil {
		tx.Rollback() //nolint:errcheck
		return err
	}
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO position_indexed_games (game_id) VALUES (?)`, gameID,
	); err != nil {
		tx.Rollback() //nolint:errcheck
		return fmt.Errorf("mark indexed: %w", err)
	}
	return tx.Commit()
}

// IndexAllGames clears the position index and rebuilds it from all games in the
// database. onProgress is called after each game with (done, total); it may be nil.
// Per-game errors are logged but do not abort the full pass.
func (d *DB) IndexAllGames(ctx context.Context, onProgress func(done, total int)) error {
	// Truncate all three tables in a single transaction.
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin clear tx: %w", err)
	}
	for _, tbl := range []string{"position_stats", "position_game_index", "position_indexed_games"} {
		if _, err := tx.Exec("DELETE FROM " + tbl); err != nil {
			tx.Rollback() //nolint:errcheck
			return fmt.Errorf("clear %s: %w", tbl, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear: %w", err)
	}

	rows, err := d.db.QueryContext(ctx, `SELECT id, pgn FROM games`)
	if err != nil {
		return fmt.Errorf("list games: %w", err)
	}
	defer rows.Close()

	// Collect all rows first so we know total for progress reporting.
	type gameRow struct{ id, pgn string }
	var all []gameRow
	for rows.Next() {
		var r gameRow
		if err := rows.Scan(&r.id, &r.pgn); err != nil {
			log.Printf("[position-index] scan game row: %v", err)
			continue
		}
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate games: %w", err)
	}
	total := len(all)

	for i, r := range all {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := d.IndexGame(r.id); err != nil {
			log.Printf("[position-index] index game %s: %v", r.id, err)
		}
		if onProgress != nil {
			onProgress(i+1, total)
		}
	}
	return nil
}

// GameCount returns the total number of games in the database.
func (d *DB) GameCount() (int64, error) {
	var n int64
	return n, d.db.QueryRow(`SELECT COUNT(*) FROM games`).Scan(&n)
}

// IndexedGameCount returns the number of games that have been indexed into the
// position tables (i.e. rows in position_indexed_games).
func (d *DB) IndexedGameCount() (int64, error) {
	var n int64
	return n, d.db.QueryRow(`SELECT COUNT(*) FROM position_indexed_games`).Scan(&n)
}

// GetPersonalPositionStats returns aggregated move statistics for the position
// described by fen, optionally filtered by folder, collection, or player name.
//
// When no filters are set, the pre-aggregated position_stats table is queried
// directly (fast path). With filters, stats are aggregated on-the-fly from
// position_game_index joined to games.
func (d *DB) GetPersonalPositionStats(fen string, f PositionFilters) ([]PersonalMoveStat, error) {
	hash, err := masterdb.HashFEN(fen)
	if err != nil {
		return nil, fmt.Errorf("hash FEN: %w", err)
	}

	if f.FolderID == "" && f.CollectionID == "" && f.PlayerName == "" && len(f.PlayerNames) == 0 &&
		f.DateFrom == "" && f.DateTo == "" {
		return d.getPersonalStatsUnfiltered(hash)
	}
	return d.getPersonalStatsFiltered(hash, f)
}

func (d *DB) getPersonalStatsUnfiltered(hash int64) ([]PersonalMoveStat, error) {
	rows, err := d.db.Query(`
		SELECT move_san, wins, draws, losses, total_elo, elo_count, total_accuracy, accuracy_count
		FROM position_stats WHERE position_hash = ?`,
		hash,
	)
	if err != nil {
		return nil, fmt.Errorf("query position_stats: %w", err)
	}
	defer rows.Close()

	var stats []PersonalMoveStat
	for rows.Next() {
		var s PersonalMoveStat
		var totalElo, eloCount int
		var totalAccuracy float64
		var accuracyCount int
		if err := rows.Scan(&s.MoveSAN, &s.WhiteWins, &s.Draws, &s.BlackWins,
			&totalElo, &eloCount, &totalAccuracy, &accuracyCount); err != nil {
			return nil, fmt.Errorf("scan position_stats: %w", err)
		}
		s.Total = s.WhiteWins + s.Draws + s.BlackWins
		if eloCount > 0 {
			s.AvgElo = totalElo / eloCount
		}
		if accuracyCount > 0 {
			s.AvgAccuracy = totalAccuracy / float64(accuracyCount)
		}
		stats = append(stats, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate position_stats: %w", err)
	}

	// Sort by total descending.
	sortMoveStats(stats)
	return stats, nil
}

func (d *DB) getPersonalStatsFiltered(hash int64, f PositionFilters) ([]PersonalMoveStat, error) {
	q, args := buildPositionStatsQuery(hash, f)
	rows, err := d.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("query filtered position stats: %w", err)
	}
	defer rows.Close()

	var stats []PersonalMoveStat
	for rows.Next() {
		var s PersonalMoveStat
		var totalElo, eloCount int
		if err := rows.Scan(&s.MoveSAN, &s.WhiteWins, &s.Draws, &s.BlackWins, &totalElo, &eloCount); err != nil {
			return nil, fmt.Errorf("scan filtered stats: %w", err)
		}
		s.Total = s.WhiteWins + s.Draws + s.BlackWins
		if eloCount > 0 {
			s.AvgElo = totalElo / eloCount
		}
		if s.Total > 0 {
			stats = append(stats, s)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate filtered stats: %w", err)
	}

	// Pull accuracy from position_stats (pre-aggregated, not filterable per game).
	// accuracy_count = 0 means no analysis data — AvgAccuracy stays 0.
	accRows, err := d.db.Query(`
		SELECT move_san, total_accuracy, accuracy_count
		FROM position_stats WHERE position_hash = ?`, hash)
	if err == nil {
		defer accRows.Close()
		acc := make(map[string][2]float64) // move_san → [total, count]
		for accRows.Next() {
			var moveSAN string
			var totalAcc float64
			var accCount int
			if accRows.Scan(&moveSAN, &totalAcc, &accCount) == nil && accCount > 0 {
				acc[moveSAN] = [2]float64{totalAcc, float64(accCount)}
			}
		}
		for i := range stats {
			if v, ok := acc[stats[i].MoveSAN]; ok {
				stats[i].AvgAccuracy = v[0] / v[1]
			}
		}
	}

	sortMoveStats(stats)
	return stats, nil
}

// GetPersonalGamesAtPosition returns up to limit games that reached the position
// described by fen, optionally filtered. Results are sorted by date descending.
func (d *DB) GetPersonalGamesAtPosition(fen string, limit int, f PositionFilters) ([]PersonalGameSummary, error) {
	hash, err := masterdb.HashFEN(fen)
	if err != nil {
		return nil, fmt.Errorf("hash FEN: %w", err)
	}

	q, args := buildPositionGamesQuery(hash, limit, f)
	rows, err := d.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("query games at position: %w", err)
	}
	defer rows.Close()

	var games []PersonalGameSummary
	for rows.Next() {
		var g PersonalGameSummary
		var whiteElo, blackElo sql.NullInt64
		if err := rows.Scan(
			&g.ID, &g.White, &g.Black, &g.Result, &g.Date,
			&whiteElo, &blackElo, &g.TimeControl, &g.MoveSAN,
		); err != nil {
			return nil, fmt.Errorf("scan game: %w", err)
		}
		if whiteElo.Valid {
			v := int(whiteElo.Int64)
			g.WhiteElo = &v
		}
		if blackElo.Valid {
			v := int(blackElo.Int64)
			g.BlackElo = &v
		}
		games = append(games, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate games: %w", err)
	}
	return games, nil
}


// positionFilterSQL builds the JOIN and WHERE fragments shared by stats and
// games queries. The base WHERE condition (position_hash = ?) is included;
// the caller must supply hash as the first positional arg.
func positionFilterSQL(hash int64, f PositionFilters) (joins string, where []string, args []any) {
	args = []any{hash}
	where = []string{"pgi.position_hash = ?"}

	if f.CollectionID != "" {
		joins += " JOIN game_collections _gc ON _gc.game_id = g.id AND _gc.collection_id = ?"
		args = append(args, f.CollectionID)
	}
	if f.FolderID != "" {
		where = append(where, "g.folder_id = ?")
		args = append(args, f.FolderID)
	}
	if len(f.PlayerNames) > 0 {
		lowers := make([]any, len(f.PlayerNames))
		for i, n := range f.PlayerNames {
			lowers[i] = strings.ToLower(n)
		}
		ph := strings.Repeat("?,", len(lowers))
		ph = ph[:len(ph)-1]
		switch f.PlayerSide {
		case "white":
			where = append(where, "LOWER(g.white) IN ("+ph+")")
			args = append(args, lowers...)
		case "black":
			where = append(where, "LOWER(g.black) IN ("+ph+")")
			args = append(args, lowers...)
		default:
			where = append(where, "(LOWER(g.white) IN ("+ph+") OR LOWER(g.black) IN ("+ph+"))")
			args = append(args, lowers...)
			args = append(args, lowers...)
		}
	} else if f.PlayerName != "" {
		pat := "%" + strings.ToLower(f.PlayerName) + "%"
		switch f.PlayerSide {
		case "white":
			where = append(where, "LOWER(g.white) LIKE ?")
			args = append(args, pat)
		case "black":
			where = append(where, "LOWER(g.black) LIKE ?")
			args = append(args, pat)
		default:
			where = append(where, "(LOWER(g.white) LIKE ? OR LOWER(g.black) LIKE ?)")
			args = append(args, pat, pat)
		}
	}
	if f.DateFrom != "" {
		// Dates are stored as "YYYY.MM.DD[...]" (PGN format); convert for lexicographic comparison.
		where = append(where, "g.date >= ?")
		args = append(args, strings.ReplaceAll(f.DateFrom, "-", "."))
	}
	if f.DateTo != "" {
		// "~" (ASCII 126) sorts after any time suffix on the same day ("YYYY.MM.DD 23:59:59").
		where = append(where, "g.date <= ?")
		args = append(args, strings.ReplaceAll(f.DateTo, "-", ".")+"~")
	}
	return joins, where, args
}

// GetPlayerSuggestions returns up to 10 distinct player names that begin with
// the given prefix (case-insensitive). Used to power the Explorer filter autocomplete.
func (d *DB) GetPlayerSuggestions(prefix string) ([]string, error) {
	if prefix == "" {
		return []string{}, nil
	}
	pat := strings.ToLower(prefix) + "%"
	rows, err := d.db.Query(`
		SELECT DISTINCT name FROM (
			SELECT white AS name FROM games WHERE LOWER(white) LIKE ?
			UNION
			SELECT black AS name FROM games WHERE LOWER(black) LIKE ?
		)
		ORDER BY name LIMIT 10
	`, pat, pat)
	if err != nil {
		return nil, fmt.Errorf("GetPlayerSuggestions: %w", err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan player suggestion: %w", err)
		}
		names = append(names, name)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	if names == nil {
		names = []string{}
	}
	return names, nil
}

func buildPositionStatsQuery(hash int64, f PositionFilters) (string, []any) {
	joins, where, args := positionFilterSQL(hash, f)

	q := `SELECT pgi.move_san,
		SUM(CASE WHEN g.result = '1-0'     THEN 1 ELSE 0 END),
		SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END),
		SUM(CASE WHEN g.result = '0-1'     THEN 1 ELSE 0 END),
		SUM(CASE WHEN g.white_elo > 0 AND g.black_elo > 0
		         THEN (g.white_elo + g.black_elo) / 2 ELSE 0 END),
		SUM(CASE WHEN g.white_elo > 0 AND g.black_elo > 0 THEN 1 ELSE 0 END)
	FROM position_game_index pgi
	JOIN games g ON g.id = pgi.game_id` + joins + `
	WHERE ` + strings.Join(where, " AND ") + `
	GROUP BY pgi.move_san`
	return q, args
}

func buildPositionGamesQuery(hash int64, limit int, f PositionFilters) (string, []any) {
	joins, where, args := positionFilterSQL(hash, f)

	orderBy := `(COALESCE(g.white_elo, 0) + COALESCE(g.black_elo, 0)) DESC, g.date DESC`
	if f.SortBy == "date" {
		orderBy = `g.date DESC, (COALESCE(g.white_elo, 0) + COALESCE(g.black_elo, 0)) DESC`
	}

	q := `SELECT g.id, g.white, g.black, g.result, g.date,
		g.white_elo, g.black_elo, g.time_control, pgi.move_san
	FROM position_game_index pgi
	JOIN games g ON g.id = pgi.game_id` + joins + `
	WHERE ` + strings.Join(where, " AND ") + `
	ORDER BY ` + orderBy + `
	LIMIT ?`
	args = append(args, limit)
	return q, args
}

func sortMoveStats(stats []PersonalMoveStat) {
	slices.SortFunc(stats, func(a, b PersonalMoveStat) int {
		return cmp.Compare(b.Total, a.Total) // descending
	})
}

// UpdatePositionAccuracyFromEvals replays the PGN, hashes each position up to
// GameIndexMaxPly, and increments total_accuracy/accuracy_count in position_stats
// for every move whose accuracy is > 0 in the provided evals slice.
// MoveEval.Ply is 1-indexed: ply 1 is the first half-move played from positions[0].
// Called non-blocking after CompleteAnalysis; errors are logged and swallowed.
// Note: if a game is re-analysed, the old contribution is not subtracted — this is
// an acceptable V1 approximation since complete re-analysis is rare.
func (d *DB) UpdatePositionAccuracyFromEvals(gameID, pgn string, evals []analysis.MoveEval) error {
	accMap := make(map[int]float64, len(evals))
	for _, e := range evals {
		if e.Accuracy > 0 {
			accMap[e.Ply] = e.Accuracy
		}
	}
	if len(accMap) == 0 {
		return nil
	}

	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		return fmt.Errorf("parse PGN: %w", err)
	}
	g := chess.NewGame()
	updateFn(g)
	moves := g.Moves()
	positions := g.Positions()
	if len(moves) == 0 {
		return nil
	}

	an := chess.AlgebraicNotation{}

	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	for i, move := range moves {
		if i >= masterdb.GameIndexMaxPly {
			break
		}
		if i >= len(positions) {
			break // positions slice shorter than moves (annotated PGN edge case)
		}
		acc, ok := accMap[i+1] // ply is 1-indexed
		if !ok {
			continue
		}
		hash, herr := masterdb.HashFEN(positions[i].String())
		if herr != nil {
			continue
		}
		san := an.Encode(positions[i], move)
		if _, err := tx.Exec(`
			UPDATE position_stats
			SET total_accuracy = total_accuracy + ?, accuracy_count = accuracy_count + 1
			WHERE position_hash = ? AND move_san = ?`,
			acc, hash, san,
		); err != nil {
			tx.Rollback() //nolint:errcheck
			return fmt.Errorf("update accuracy: %w", err)
		}
	}
	return tx.Commit()
}

// BackfillPositionAccuracyIfNeeded runs once per database lifetime: it reads
// all stored completed analyses (which include the per-move evals JSON) and
// populates total_accuracy/accuracy_count in position_stats for any game that
// was analysed before Epic 5.3 introduced the accuracy columns.
//
// A settings flag ("position_accuracy_backfill_done") prevents it from running
// more than once. The work is done synchronously so the caller (onStartup) can
// spin it off as a goroutine.
func (d *DB) BackfillPositionAccuracyIfNeeded() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[backfill-accuracy] recovered from panic: %v", r)
		}
	}()

	done, _ := d.GetSetting("position_accuracy_backfill_done")
	if done == "1" {
		return
	}

	// Collect all rows before processing — the single DB connection cannot
	// service a new transaction (UpdatePositionAccuracyFromEvals) while the
	// query cursor is still open.
	type backfillRow struct {
		gameID, pgn, evalsJSON string
	}
	var pending []backfillRow

	rows, err := d.db.Query(`
		SELECT ga.game_id, g.pgn, ga.evals
		FROM game_analyses ga
		JOIN games g ON g.id = ga.game_id
		WHERE ga.status = 'complete' AND ga.evals IS NOT NULL AND ga.evals != ''`)
	if err != nil {
		log.Printf("[backfill-accuracy] query failed: %v", err)
		return
	}
	for rows.Next() {
		var r backfillRow
		if err := rows.Scan(&r.gameID, &r.pgn, &r.evalsJSON); err != nil {
			continue
		}
		pending = append(pending, r)
	}
	rows.Close()

	n := 0
	for _, r := range pending {
		var evals []analysis.MoveEval
		if err := json.Unmarshal([]byte(r.evalsJSON), &evals); err != nil {
			continue
		}
		if err := d.UpdatePositionAccuracyFromEvals(r.gameID, r.pgn, evals); err != nil {
			log.Printf("[backfill-accuracy] game %s: %v", r.gameID, err)
		}
		n++
	}
	log.Printf("[backfill-accuracy] populated accuracy for %d analysed games", n)
	_ = d.SetSetting("position_accuracy_backfill_done", "1")
}

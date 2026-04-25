package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

// SaveGame inserts a new game and returns its generated ID.
// Returns ErrDuplicate if a game with the same source+source_id or the same
// identity hash (white+black+date+result+moves) already exists.
func (d *DB) SaveGame(input game.GameInput) (string, error) {
	id := uuid.New().String()
	ts := now()

	eco := input.ECO
	if eco == "" || eco == "?" {
		eco = game.ExtractHeader(input.PGN, "ECO")
	}
	openingName := input.Opening
	if openingName == "" || openingName == "?" {
		openingName = game.ExtractHeader(input.PGN, "Opening")
	}
	// PGN headers use "?" as a placeholder for unknown values — treat as empty.
	if eco == "?" {
		eco = ""
	}
	if openingName == "?" {
		openingName = ""
	}
	// Always prefer classification from moves — more reliable than PGN headers.
	if e := d.classifyGame(input.PGN); e != nil {
		eco = e.ECO
		openingName = e.Name
	}

	identityHash := game.GameHash(input.PGN, input.White, input.Black, input.Date, input.Result)

	_, err := d.db.Exec(`
		INSERT INTO games
			(id, white, black, white_elo, black_elo, result, date, event, site, round,
			 eco, opening, time_control, source, source_id, identity_hash, pgn, created_at, updated_at)
		VALUES
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		input.White, input.Black,
		nullInt(input.WhiteElo), nullInt(input.BlackElo),
		result(input.Result),
		input.Date, input.Event, input.Site, input.Round,
		eco, openingName, input.TimeControl,
		source(input.Source),
		nullString(input.SourceID),
		identityHash,
		input.PGN,
		ts, ts,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return "", ErrDuplicate
		}
		return "", fmt.Errorf("insert game: %w", err)
	}

	// Index positions for the Explorer panel. Failures are non-fatal — they
	// must not block game saves.
	if err := d.IndexGame(id); err != nil {
		log.Printf("[position-index] failed to index game %s: %v", id, err)
	}

	return id, nil
}

// GetGame returns the full game record for the given ID.
func (d *DB) GetGame(id string) (*game.GameRecord, error) {
	row := d.db.QueryRow(`
		SELECT id, white, black, white_elo, black_elo, result, date, event, site, round,
		       eco, opening, time_control, source, folder_id, pgn
		FROM games WHERE id = ?`, id)

	g, err := scanRecord(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get game: %w", err)
	}
	return g, nil
}

// ListGames returns game summaries matching the given filters.
// Each summary includes the names of any collections the game belongs to.
func (d *DB) ListGames(filters game.GameFilters) ([]game.GameSummary, error) {
	q, args := buildListQuery(filters)
	rows, err := d.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("list games: %w", err)
	}
	defer rows.Close()

	var games []game.GameSummary
	for rows.Next() {
		var g game.GameSummary
		var whiteElo, blackElo sql.NullInt64
		var folderID, analysisStatus sql.NullString
		if err := rows.Scan(
			&g.ID, &g.White, &g.Black, &whiteElo, &blackElo,
			&g.Result, &g.Date, &g.Event, &g.ECO, &g.Opening, &g.TimeControl, &g.Source, &folderID,
			&analysisStatus,
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
		if folderID.Valid {
			s := folderID.String
			g.FolderID = &s
		}
		if analysisStatus.Valid {
			s := analysisStatus.String
			g.AnalysisStatus = &s
		}
		games = append(games, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(games) == 0 {
		return games, nil
	}

	// Attach collection names in a single follow-up query to avoid N+1.
	ids := make([]any, len(games))
	idIndex := make(map[string]int, len(games))
	for i, g := range games {
		ids[i] = g.ID
		idIndex[g.ID] = i
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]
	collRows, err := d.db.Query(
		`SELECT gc.game_id, c.name
		 FROM game_collections gc
		 JOIN collections c ON c.id = gc.collection_id
		 WHERE gc.game_id IN (`+placeholders+`)
		 ORDER BY c.name`,
		ids...,
	)
	if err != nil {
		return nil, fmt.Errorf("list collection names: %w", err)
	}
	defer collRows.Close()
	for collRows.Next() {
		var gameID, name string
		if err := collRows.Scan(&gameID, &name); err != nil {
			return nil, fmt.Errorf("scan collection name: %w", err)
		}
		if i, ok := idIndex[gameID]; ok {
			games[i].CollectionNames = append(games[i].CollectionNames, name)
		}
	}
	return games, collRows.Err()
}

// UpdateGame replaces the PGN of an existing game (preserving all metadata).
// eco and opening are re-classified from the new moves unless the user has
// explicitly overridden them via UpdateGameMetadata (classification_overridden=1).
func (d *DB) UpdateGame(id, pgn string) error {
	ts := now()

	newECO, newOpening := "", ""
	if e := d.classifyGame(pgn); e != nil {
		newECO = e.ECO
		newOpening = e.Name
	}

	res, err := d.db.Exec(`
		UPDATE games
		SET pgn = ?,
		    eco     = CASE WHEN classification_overridden = 0 THEN ? ELSE eco     END,
		    opening = CASE WHEN classification_overridden = 0 THEN ? ELSE opening END,
		    updated_at = ?
		WHERE id = ?`,
		pgn, newECO, newOpening, ts, id,
	)
	if err != nil {
		return fmt.Errorf("update game: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateGameMetadata updates the editable header columns of an existing game
// and rewrites the pgn column in a single atomic UPDATE.
// identity_hash is recomputed from the new pgn and the new metadata so that
// deduplication remains correct after a metadata edit.
func (d *DB) UpdateGameMetadata(id string, m game.GameMetadataInput) error {
	var pgn string
	err := d.db.QueryRow(`SELECT pgn FROM games WHERE id = ?`, id).Scan(&pgn)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("fetch pgn for metadata update: %w", err)
	}

	newPGN := game.UpdateHeaders(pgn, m)
	h := game.GameHash(newPGN, m.White, m.Black, m.Date, m.Result)

	// Determine eco, opening, and the override flag.
	// If the user explicitly set either field, honour both and lock them from
	// automatic reclassification on future UpdateGame calls. Any field the user
	// left blank is filled in via ClassifyGame so the record stays complete.
	// When both are empty the game is fully auto-classified and the lock is cleared.
	var ecoVal, openingName string
	var overridden int
	if m.ECO == "" && m.Opening == "" {
		if e := d.classifyGame(newPGN); e != nil {
			ecoVal = e.ECO
			openingName = e.Name
		}
		overridden = 0
	} else {
		overridden = 1
		ecoVal = m.ECO
		openingName = m.Opening
		// Fill in whichever field the user left blank.
		if ecoVal == "" || openingName == "" {
			if e := d.classifyGame(newPGN); e != nil {
				if ecoVal == "" {
					ecoVal = e.ECO
				}
				if openingName == "" {
					openingName = e.Name
				}
			}
		}
	}

	ts := now()
	res, err := d.db.Exec(`
		UPDATE games
		SET white=?, black=?, white_elo=?, black_elo=?, result=?, date=?, event=?, site=?, round=?, eco=?, opening=?, classification_overridden=?, identity_hash=?, pgn=?, updated_at=?
		WHERE id=?`,
		m.White, m.Black,
		nullInt(m.WhiteElo), nullInt(m.BlackElo),
		result(m.Result),
		m.Date, m.Event, m.Site, m.Round, ecoVal, openingName, overridden,
		h, newPGN, ts, id,
	)
	if err != nil {
		return fmt.Errorf("update game metadata: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteGame removes a game by ID.
func (d *DB) DeleteGame(id string) error {
	res, err := d.db.Exec(`DELETE FROM games WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete game: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}

	// Remove position index rows for the deleted game. The pre-aggregated
	// position_stats table is NOT decremented — after bulk-deleting games, use
	// ReindexPersonalGames from Settings to restore accurate stats.
	d.db.Exec(`DELETE FROM position_game_index WHERE game_id = ?`, id)   //nolint:errcheck
	d.db.Exec(`DELETE FROM position_indexed_games WHERE game_id = ?`, id) //nolint:errcheck

	return nil
}

// FindDuplicateGame returns the ID of an existing game whose identity hash
// matches input (same white, black, date, result, and main-line moves).
// Returns ("", nil) when no duplicate exists.
func (d *DB) FindDuplicateGame(input game.GameInput) (string, error) {
	h := game.GameHash(input.PGN, input.White, input.Black, input.Date, input.Result)
	var id string
	err := d.db.QueryRow(`SELECT id FROM games WHERE identity_hash = ? LIMIT 1`, h).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find duplicate game: %w", err)
	}
	return id, nil
}

// backfillIdentityHash computes and stores identity_hash for all games that
// were inserted before this column was introduced. Pre-existing duplicate pairs
// (same hash) are logged and left as NULL — they cannot be resolved
// automatically without data loss.
func (d *DB) backfillIdentityHash() error {
	rows, err := d.db.Query(`SELECT id, white, black, date, result, pgn FROM games WHERE identity_hash IS NULL`)
	if err != nil {
		return fmt.Errorf("backfill query: %w", err)
	}
	defer rows.Close()

	type row struct{ id, white, black, date, result, pgn string }
	var games []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.white, &r.black, &r.date, &r.result, &r.pgn); err != nil {
			return fmt.Errorf("backfill scan: %w", err)
		}
		games = append(games, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close() // close before writing — avoids lock contention with MaxOpenConns(1)

	for _, g := range games {
		h := game.GameHash(g.pgn, g.white, g.black, g.date, g.result)
		if _, err := d.db.Exec(`UPDATE games SET identity_hash = ? WHERE id = ?`, h, g.id); err != nil {
			if isUniqueViolation(err) {
				log.Printf("[identity_hash] backfill: pre-existing duplicate hash %s for game %s — leaving NULL", h, g.id)
				continue
			}
			return fmt.Errorf("backfill update %s: %w", g.id, err)
		}
	}
	return nil
}


// now returns the current UTC time in RFC 3339 format for database timestamps.
func now() string { return time.Now().UTC().Format(time.RFC3339) }

func scanRecord(row *sql.Row) (*game.GameRecord, error) {
	var g game.GameRecord
	var whiteElo, blackElo sql.NullInt64
	var folderID sql.NullString
	err := row.Scan(
		&g.ID, &g.White, &g.Black, &whiteElo, &blackElo,
		&g.Result, &g.Date, &g.Event, &g.Site, &g.Round,
		&g.ECO, &g.Opening, &g.TimeControl, &g.Source, &folderID, &g.PGN,
	)
	if err != nil {
		return nil, err
	}
	if whiteElo.Valid {
		v := int(whiteElo.Int64)
		g.WhiteElo = &v
	}
	if blackElo.Valid {
		v := int(blackElo.Int64)
		g.BlackElo = &v
	}
	if folderID.Valid {
		s := folderID.String
		g.FolderID = &s
	}
	return &g, nil
}

func buildListQuery(f game.GameFilters) (string, []any) {
	var where []string
	var args []any

	// Recursive CTE for subfolder traversal — prepended when IncludeSubfolders is set.
	var cte string
	var cteArgs []any

	if f.Player != "" {
		where = append(where, "(LOWER(g.white) LIKE ? OR LOWER(g.black) LIKE ?)")
		pat := "%" + strings.ToLower(f.Player) + "%"
		args = append(args, pat, pat)
	}
	if f.White != "" {
		where = append(where, "LOWER(g.white) LIKE ?")
		args = append(args, "%"+strings.ToLower(f.White)+"%")
	}
	if f.Black != "" {
		where = append(where, "LOWER(g.black) LIKE ?")
		args = append(args, "%"+strings.ToLower(f.Black)+"%")
	}
	if f.Result != "" {
		where = append(where, "g.result = ?")
		args = append(args, f.Result)
	}
	if f.ECO != "" {
		where = append(where, "g.eco LIKE ?")
		args = append(args, f.ECO+"%")
	}
	if f.DateFrom != "" {
		// Dates are stored as "YYYY.MM.DD[ HH:MM:SS]" (PGN format).
		// Convert YYYY-MM-DD input to YYYY.MM.DD for correct lexicographic comparison.
		where = append(where, "g.date >= ?")
		args = append(args, strings.ReplaceAll(f.DateFrom, "-", "."))
	}
	if f.DateTo != "" {
		// Use YYYY.MM.DD/ as the upper bound so that dates with a time component
		// (e.g. "2024.04.07 14:30:00") are still included. "/" is ASCII 47, one
		// above "." (46), so it sorts just after any time suffix for that day.
		where = append(where, "g.date <= ?")
		args = append(args, strings.ReplaceAll(f.DateTo, "-", ".")+"~")
	}
	if f.Source != "" {
		where = append(where, "g.source = ?")
		args = append(args, f.Source)
	}
	if f.CollectionID != "" {
		where = append(where, "g.id IN (SELECT game_id FROM game_collections WHERE collection_id = ?)")
		args = append(args, f.CollectionID)
	}
	if len(f.PlayerNames) > 0 {
		lowers := make([]any, len(f.PlayerNames))
		ph := make([]string, len(f.PlayerNames))
		for i, n := range f.PlayerNames {
			lowers[i] = strings.ToLower(n)
			ph[i] = "?"
		}
		inList := strings.Join(ph, ",")
		where = append(where, "(LOWER(g.white) IN ("+inList+") OR LOWER(g.black) IN ("+inList+"))")
		args = append(args, lowers...)
		args = append(args, lowers...)
	}
	if len(f.TimeControls) > 0 {
		// Parse base seconds from time_control ("600+0" -> 600, "300" -> 300).
		// Must mirror game.CategorizeTimeControl: bullet <180, blitz [180,600),
		// rapid [600,1800), classical >=1800, other = anything that doesn't parse
		// to a positive integer (NULL/''/'-'/'?'/non-numeric).
		const baseSecsExpr = `CAST(
			CASE
				WHEN g.time_control IS NULL THEN ''
				WHEN instr(g.time_control, '+') > 0
					THEN substr(g.time_control, 1, instr(g.time_control, '+') - 1)
				ELSE g.time_control
			END AS INTEGER)`
		seen := map[string]bool{}
		var ors []string
		for _, c := range f.TimeControls {
			if seen[c] {
				continue
			}
			seen[c] = true
			switch c {
			case "bullet":
				ors = append(ors, "("+baseSecsExpr+" > 0 AND "+baseSecsExpr+" < 180)")
			case "blitz":
				ors = append(ors, "("+baseSecsExpr+" >= 180 AND "+baseSecsExpr+" < 600)")
			case "rapid":
				ors = append(ors, "("+baseSecsExpr+" >= 600 AND "+baseSecsExpr+" < 1800)")
			case "classical":
				ors = append(ors, "("+baseSecsExpr+" >= 1800)")
			case "other":
				// CAST of a non-numeric string yields 0 in SQLite; this also covers NULL/''/'-'/'?'.
				ors = append(ors, "("+baseSecsExpr+" <= 0)")
			}
		}
		if len(ors) > 0 {
			where = append(where, "("+strings.Join(ors, " OR ")+")")
		}
	}
	if f.Unfiled {
		where = append(where, "g.folder_id IS NULL")
	} else if f.FolderID != "" {
		if f.IncludeSubfolders {
			cte = `WITH RECURSIVE subtree(id) AS (
				SELECT id FROM folders WHERE id = ?
				UNION ALL
				SELECT fol.id FROM folders fol JOIN subtree s ON fol.parent_id = s.id
			) `
			cteArgs = []any{f.FolderID}
			where = append(where, "g.folder_id IN (SELECT id FROM subtree)")
		} else {
			where = append(where, "g.folder_id = ?")
			args = append(args, f.FolderID)
		}
	}

	q := cte + `SELECT g.id, g.white, g.black, g.white_elo, g.black_elo, g.result, g.date, g.event,
	             g.eco, g.opening, g.time_control, g.source, g.folder_id, ga.status
	      FROM games g
	      LEFT JOIN game_analyses ga ON ga.game_id = g.id`
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY g.date DESC, g.created_at DESC"

	if f.Limit != -1 {
		limit := f.Limit
		if limit <= 0 {
			limit = 200
		}
		q += fmt.Sprintf(" LIMIT %d", limit)
		if f.Offset > 0 {
			q += fmt.Sprintf(" OFFSET %d", f.Offset)
		}
	}
	return q, append(cteArgs, args...)
}

func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func result(r string) string {
	if r == "" {
		return "*"
	}
	return r
}

func source(s string) string {
	if s == "" {
		return "manual"
	}
	return s
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

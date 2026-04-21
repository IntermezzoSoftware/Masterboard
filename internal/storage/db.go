package storage

import (
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/IntermezzoSoftware/Masterboard/internal/opening"
	_ "modernc.org/sqlite" // register the "sqlite" driver
)

//go:embed schema.sql
var schemaFS embed.FS

// DB wraps a SQLite connection and provides all persistence methods.
type DB struct {
	db         *sql.DB
	classifier *opening.Classifier
}

// Open opens (or creates) the SQLite database at path and runs the schema
// migrations. The parent directory is created if it does not exist.
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// SQLite performs best with a single writer connection.
	db.SetMaxOpenConns(1)

	schema, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("read schema: %w", err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	// Idempotent column/table migrations for databases that predate the current schema.
	if _, err := db.Exec(`ALTER TABLE games ADD COLUMN opening TEXT NOT NULL DEFAULT ''`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate games.opening: %w", err)
		}
	}

	// folders table (safe to re-run; IF NOT EXISTS is idempotent)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS folders (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		UNIQUE(parent_id, name)
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate folders table: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_folders_parent: %w", err)
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_name_root ON folders(name) WHERE parent_id IS NULL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_folders_name_root: %w", err)
	}

	// games.folder_id
	if _, err := db.Exec(`ALTER TABLE games ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate games.folder_id: %w", err)
		}
	}

	// repertoires table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS repertoires (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		colour      TEXT NOT NULL CHECK(colour IN ('white', 'black')),
		description TEXT NOT NULL DEFAULT '',
		created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate repertoires table: %w", err)
	}

	// repertoire_moves table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS repertoire_moves (
		id              TEXT PRIMARY KEY,
		repertoire_id   TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
		parent_id       TEXT REFERENCES repertoire_moves(id) ON DELETE CASCADE,
		from_fen        TEXT NOT NULL,
		to_fen          TEXT NOT NULL,
		move_san        TEXT NOT NULL,
		move_uci        TEXT NOT NULL,
		move_order      INTEGER NOT NULL DEFAULT 0,
		nag             INTEGER,
		comment         TEXT NOT NULL DEFAULT '',
		shapes          TEXT NOT NULL DEFAULT '',
		created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate repertoire_moves table: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_repertoire_moves_repertoire ON repertoire_moves(repertoire_id)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_repertoire_moves_repertoire: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_repertoire_moves_parent ON repertoire_moves(parent_id)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_repertoire_moves_parent: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_repertoire_moves_fen ON repertoire_moves(repertoire_id, from_fen)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_repertoire_moves_fen: %w", err)
	}

	// game_analyses table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS game_analyses (
		game_id        TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
		depth          INTEGER NOT NULL,
		white_accuracy REAL,
		black_accuracy REAL,
		status         TEXT NOT NULL DEFAULT 'pending'
		               CHECK(status IN ('pending','running','complete','error')),
		error_msg      TEXT,
		analysed_at    TEXT,
		created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate game_analyses table: %w", err)
	}

	// Drop legacy game_move_evals table — evals are now stored as JSON on game_analyses.
	db.Exec(`DROP INDEX IF EXISTS idx_game_move_evals_game`)
	db.Exec(`DROP TABLE IF EXISTS game_move_evals`)

	// position_stats — pre-aggregated W/D/L per (position, move); unfiltered fast path.
	// W/D/L stored from white's perspective: 1-0 → wins++, 0-1 → losses++.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS position_stats (
		position_hash INTEGER NOT NULL,
		move_san      TEXT    NOT NULL,
		wins          INTEGER NOT NULL DEFAULT 0,
		draws         INTEGER NOT NULL DEFAULT 0,
		losses        INTEGER NOT NULL DEFAULT 0,
		total_elo     INTEGER NOT NULL DEFAULT 0,
		elo_count     INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (position_hash, move_san)
	) WITHOUT ROWID`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate position_stats table: %w", err)
	}

	// position_game_index — per-game position index for filtered queries.
	// game_id is a TEXT UUID (matches games.id). move_san is the move played
	// from this position in this game. Capped at GameIndexMaxPly (50) half-moves.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS position_game_index (
		position_hash INTEGER NOT NULL,
		game_id       TEXT    NOT NULL,
		move_san      TEXT    NOT NULL DEFAULT '',
		PRIMARY KEY (position_hash, game_id)
	) WITHOUT ROWID`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate position_game_index table: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_position_game_index_game ON position_game_index(game_id)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_position_game_index_game: %w", err)
	}

	// position_indexed_games — tracks which games have been indexed; used to skip
	// re-indexing on SaveGame when a game was already processed.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS position_indexed_games (
		game_id TEXT PRIMARY KEY
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate position_indexed_games table: %w", err)
	}

	// is_transposition column for repertoire_moves
	if _, err := db.Exec(`ALTER TABLE repertoire_moves ADD COLUMN is_transposition INTEGER NOT NULL DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate repertoire_moves.is_transposition: %w", err)
		}
	}
	// Recompute is_transposition for all existing moves using PositionFen() so that
	// routes reaching the same board position via different halfmove-clock values are
	// correctly treated as transpositions.  This replaces the earlier SQL-only cleanup
	// and backfill passes, which used strict to_fen equality and therefore missed
	// transpositions introduced by different halfmove clocks.
	if err := migrateTranspositionFlags(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate transposition flags: %w", err)
	}

	// Add ACPL + evals columns to game_analyses (idempotent migrations).
	for _, col := range []string{"white_acpl", "black_acpl"} {
		db.Exec(fmt.Sprintf(`ALTER TABLE game_analyses ADD COLUMN %s REAL`, col))
	}
	db.Exec(`ALTER TABLE game_analyses ADD COLUMN evals TEXT`)
	db.Exec(`ALTER TABLE game_analyses ADD COLUMN pgn_annotated INTEGER NOT NULL DEFAULT 0`)
	db.Exec(`ALTER TABLE game_analyses ADD COLUMN applied_evals TEXT`)

	// identity_hash column + index (content fingerprint for duplicate detection).
	if _, err := db.Exec(`ALTER TABLE games ADD COLUMN identity_hash TEXT`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate games.identity_hash: %w", err)
		}
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_games_identity_hash ON games(identity_hash) WHERE identity_hash IS NOT NULL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate idx_games_identity_hash: %w", err)
	}

	// srs_entries — spaced repetition state for opening drill (created here; upgraded to FSRS columns below).
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS srs_entries (
		move_id          TEXT PRIMARY KEY REFERENCES repertoire_moves(id) ON DELETE CASCADE,
		interval_days    INTEGER NOT NULL DEFAULT 1,
		due_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		last_reviewed_at TEXT
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate srs_entries table: %w", err)
	}

	// 4.1b: Upgrade srs_entries to FSRS Card struct columns.
	// Detect old schema by checking for interval_days column.
	var hasOldSRS int
	db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('srs_entries') WHERE name='interval_days'`).Scan(&hasOldSRS) //nolint:errcheck
	if hasOldSRS > 0 {
		if _, err := db.Exec(`DROP TABLE srs_entries`); err != nil {
			db.Close()
			return nil, fmt.Errorf("drop old srs_entries: %w", err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS srs_entries (
		move_id        TEXT PRIMARY KEY REFERENCES repertoire_moves(id) ON DELETE CASCADE,
		due            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		stability      REAL NOT NULL DEFAULT 0,
		difficulty     REAL NOT NULL DEFAULT 0,
		elapsed_days   INTEGER NOT NULL DEFAULT 0,
		scheduled_days INTEGER NOT NULL DEFAULT 0,
		reps           INTEGER NOT NULL DEFAULT 0,
		lapses         INTEGER NOT NULL DEFAULT 0,
		state          INTEGER NOT NULL DEFAULT 0,
		last_review    TEXT
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create srs_entries (FSRS): %w", err)
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS srs_review_logs (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		move_id        TEXT NOT NULL REFERENCES repertoire_moves(id) ON DELETE CASCADE,
		rating         INTEGER NOT NULL,
		scheduled_days INTEGER NOT NULL,
		elapsed_days   INTEGER NOT NULL,
		reviewed_at    TEXT NOT NULL,
		state          INTEGER NOT NULL,
		played_uci     TEXT
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create srs_review_logs: %w", err)
	}

	// 4.1b Phase 3: Add state_before column to srs_review_logs for correct NewToLearning detection.
	if _, err := db.Exec(`ALTER TABLE srs_review_logs ADD COLUMN state_before INTEGER NOT NULL DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate srs_review_logs.state_before: %w", err)
		}
	}

	// personal_puzzles — puzzles extracted from analysed personal games.
	db.Exec(`CREATE TABLE IF NOT EXISTS personal_puzzles (
		id              TEXT PRIMARY KEY,
		game_id         TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
		ply             INTEGER NOT NULL,
		fen             TEXT NOT NULL,
		solution_uci    TEXT NOT NULL,
		solution_san    TEXT NOT NULL,
		played_move     TEXT NOT NULL,
		classification  TEXT NOT NULL,
		player_colour   TEXT NOT NULL,
		played_cp       INTEGER,
		best_cp         INTEGER,
		created_at      TEXT NOT NULL
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS srs_puzzle_entries (
		puzzle_id        TEXT PRIMARY KEY REFERENCES personal_puzzles(id) ON DELETE CASCADE,
		due              TEXT NOT NULL,
		stability        REAL NOT NULL DEFAULT 0,
		difficulty       REAL NOT NULL DEFAULT 0,
		elapsed_days     INTEGER NOT NULL DEFAULT 0,
		scheduled_days   INTEGER NOT NULL DEFAULT 0,
		reps             INTEGER NOT NULL DEFAULT 0,
		lapses           INTEGER NOT NULL DEFAULT 0,
		state            INTEGER NOT NULL DEFAULT 0,
		last_review      TEXT
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS srs_puzzle_review_logs (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		puzzle_id       TEXT NOT NULL,
		rating          INTEGER NOT NULL,
		scheduled_days  INTEGER,
		elapsed_days    INTEGER,
		reviewed_at     TEXT NOT NULL,
		state           INTEGER NOT NULL,
		state_before    INTEGER NOT NULL DEFAULT 0
	)`)

	// Track extraction status on game_analyses — swallow "duplicate column" error.
	db.Exec(`ALTER TABLE game_analyses ADD COLUMN puzzles_extracted INTEGER NOT NULL DEFAULT 0`)
	// Per-player-perspective evals — swallow "duplicate column" errors.
	db.Exec(`ALTER TABLE personal_puzzles ADD COLUMN played_cp INTEGER`)
	db.Exec(`ALTER TABLE personal_puzzles ADD COLUMN best_cp INTEGER`)

	// classification_overridden — set to 1 when the user has explicitly set eco/opening
	// via UpdateGameMetadata, preventing auto-reclassification on subsequent UpdateGame calls.
	db.Exec(`ALTER TABLE games ADD COLUMN classification_overridden INTEGER NOT NULL DEFAULT 0`)

	// position_stats accuracy columns (Epic 5.3)
	if _, err := db.Exec(`ALTER TABLE position_stats ADD COLUMN total_accuracy REAL NOT NULL DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate position_stats.total_accuracy: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE position_stats ADD COLUMN accuracy_count INTEGER NOT NULL DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column name") {
			db.Close()
			return nil, fmt.Errorf("migrate position_stats.accuracy_count: %w", err)
		}
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS game_deviations (
		game_id         TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
		deviation_ply   INTEGER NOT NULL,
		deviation_fen   TEXT,
		player_off_book INTEGER NOT NULL DEFAULT 0,
		repertoire_id   TEXT,
		expected_moves  TEXT,
		played_move     TEXT,
		detected_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate game_deviations table: %w", err)
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS gtm_results (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
		colour        TEXT NOT NULL,
		points_earned INTEGER NOT NULL,
		max_points    INTEGER NOT NULL,
		move_count    INTEGER NOT NULL,
		analysed      INTEGER NOT NULL,
		played_at     TEXT NOT NULL
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create gtm_results table: %w", err)
	}

	d := &DB{db: db}
	if err := d.backfillIdentityHash(); err != nil {
		db.Close()
		return nil, fmt.Errorf("backfill identity_hash: %w", err)
	}
	return d, nil
}

// Close closes the underlying database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

// SetClassifier wires an opening classifier into the DB so that SaveGame and
// UpdateGame can populate ECO/opening fields. Called by app.NewApp immediately
// after Open — the window between Open and SetClassifier is zero in normal use.
func (d *DB) SetClassifier(c *opening.Classifier) {
	d.classifier = c
}

// classifyGame is an internal helper that uses d.classifier when available,
// returning nil if the classifier has not been injected.
func (d *DB) classifyGame(pgn string) *opening.Entry {
	if d.classifier == nil {
		return nil
	}
	return d.classifier.ClassifyGame(pgn)
}

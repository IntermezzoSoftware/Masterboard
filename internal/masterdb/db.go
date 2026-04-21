package masterdb

import (
	"cmp"
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// schema is the main DB schema. Stats and index tables live in separate
// split DB files (_stats.db and _index.db) opened via openSplitDBs.
const schema = `
PRAGMA page_size = 4096;

CREATE TABLE IF NOT EXISTS master_games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    white       TEXT,
    black       TEXT,
    result      TEXT,
    date        TEXT,
    eco         TEXT,
    elo_white   INTEGER,
    elo_black   INTEGER,
    moves_blob  BLOB,
    fingerprint INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS master_move_lookup (
    move_id  INTEGER PRIMARY KEY,
    move_san TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS master_import_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filename       TEXT    NOT NULL,
    size_bytes     INTEGER NOT NULL,
    games_imported INTEGER NOT NULL,
    import_date    TEXT    NOT NULL
);
`

// GameIndexMaxPly is the maximum half-move depth indexed in master_position_game_index.
// Positions at ply >= GameIndexMaxPly are not included in the game index (but are
// still counted in master_position_stats, which has no depth limit).
// 50 ply = 25 full moves — matches Lichess Opening Explorer's deliberate product decision.
const GameIndexMaxPly = 50

// DB wraps a SQLite connection to the master sidecar database.
type DB struct {
	sql *sql.DB
}

// Open creates or opens the sidecar SQLite database at path.
// It applies the schema and sets performance pragmas for import mode.
// The path is resolved to an absolute Windows-native path before opening,
// because modernc.org/sqlite's VFS does not understand MSYS-style paths
// (e.g. /g/foo) — these are misinterpreted as relative to the current drive.
func Open(path string) (*DB, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve path %s: %w", path, err)
	}

	sqlDB, err := sql.Open(sqliteDriverName, absPath)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", absPath, err)
	}

	// Single writer — no concurrent access needed.
	sqlDB.SetMaxOpenConns(1)

	db := &DB{sql: sqlDB}
	if err := db.applySchema(); err != nil {
		sqlDB.Close()
		return nil, err
	}
	if err := db.setImportPragmas(); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return db, nil
}

// Close releases the database connection.
func (db *DB) Close() error {
	return db.sql.Close()
}

// OpenForQuery opens an existing finalized sidecar database for read-only
// query access. Unlike Open, it does NOT apply DDL migrations or import
// pragmas — the DB is expected to already be in WAL mode after Finalize.
// Returns (nil, nil) if path does not exist (sidecar not yet created).
//
// When the companion split DB files (_stats.db, _index.db) exist alongside
// the main DB, they are ATTACHed so that queries against master_position_stats
// and master_position_game_index resolve to the split files automatically.
// A single connection is used in split mode (ATTACH is per-connection).
func OpenForQuery(path string) (*DB, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve path %s: %w", path, err)
	}
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil, nil
	}
	sqlDB, err := sql.Open(sqliteDriverName, absPath)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", absPath, err)
	}

	statsPath, indexPath := SplitDBPaths(absPath)
	statsExists := fileExists(statsPath)
	indexExists := fileExists(indexPath)
	if statsExists || indexExists {
		sqlDB.SetMaxOpenConns(1) // ATTACH is per-connection; one connection ensures it persists
	} else {
		sqlDB.SetMaxOpenConns(4)
	}

	for _, p := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA cache_size = -32768",
		"PRAGMA temp_store = MEMORY",
		"PRAGMA mmap_size = 67108864",
	} {
		if _, err := sqlDB.Exec(p); err != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}

	if statsExists {
		if _, err := sqlDB.Exec(fmt.Sprintf(`ATTACH DATABASE %q AS statsdb`, statsPath)); err != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("attach stats db: %w", err)
		}
	}
	if indexExists {
		if _, err := sqlDB.Exec(fmt.Sprintf(`ATTACH DATABASE %q AS indexdb`, indexPath)); err != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("attach index db: %w", err)
		}
	}

	return &DB{sql: sqlDB}, nil
}

// fileExists reports whether path exists and is a regular file.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// importLogEntry is one row of import provenance metadata.
type importLogEntry struct {
	Filename      string
	SizeBytes     int64
	GamesImported int
	ImportDate    string // ISO-8601 UTC
}

// ImportSummary aggregates import provenance for the Settings page.
type ImportSummary struct {
	TotalGames int64
	FileCount  int64
	LastImport string   // ISO-8601 UTC, or "" if no imports yet
	Filenames  []string // distinct filenames in import order (for tooltip)
}

// WriteImportLog appends provenance records to master_import_log.
func (db *DB) writeImportLog(entries []importLogEntry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := db.sql.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	stmt, err := tx.Prepare(
		`INSERT INTO master_import_log (filename, size_bytes, games_imported, import_date) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare import log: %w", err)
	}
	defer stmt.Close()
	for _, e := range entries {
		if _, err := stmt.Exec(e.Filename, e.SizeBytes, e.GamesImported, e.ImportDate); err != nil {
			return fmt.Errorf("insert import log %s: %w", e.Filename, err)
		}
	}
	return tx.Commit()
}

// GetImportSummary returns aggregate import provenance from master_import_log.
// Returns zero values when no imports have been logged yet.
func (db *DB) GetImportSummary() (*ImportSummary, error) {
	s := &ImportSummary{}
	row := db.sql.QueryRow(
		`SELECT COALESCE(SUM(games_imported),0), COUNT(DISTINCT filename), COALESCE(MAX(import_date),'')
		 FROM master_import_log`)
	if err := row.Scan(&s.TotalGames, &s.FileCount, &s.LastImport); err != nil {
		return nil, fmt.Errorf("query import summary: %w", err)
	}
	// Fetch distinct filenames in insertion order for the hover tooltip.
	rows, err := db.sql.Query(
		`SELECT filename FROM master_import_log GROUP BY filename ORDER BY MIN(id)`)
	if err != nil {
		return nil, fmt.Errorf("query import filenames: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan filename: %w", err)
		}
		s.Filenames = append(s.Filenames, name)
	}
	return s, rows.Err()
}

// splitDBSchemas are the per-file schemas used in split-DB mode.
var (
	schemaStats = `
		PRAGMA page_size = 4096;
		CREATE TABLE IF NOT EXISTS master_position_stats (
			position_hash INTEGER NOT NULL,
			move_id       INTEGER NOT NULL,
			wins          INTEGER NOT NULL DEFAULT 0,
			draws         INTEGER NOT NULL DEFAULT 0,
			losses        INTEGER NOT NULL DEFAULT 0,
			total_elo     INTEGER NOT NULL DEFAULT 0,
			elo_count     INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (position_hash, move_id)
		) WITHOUT ROWID;`
	schemaIndex = `
		PRAGMA page_size = 4096;
		CREATE TABLE IF NOT EXISTS master_position_game_index (
			position_hash INTEGER NOT NULL,
			game_id       INTEGER NOT NULL,
			PRIMARY KEY (position_hash, game_id)
		) WITHOUT ROWID;`
)

// openPartial opens a SQLite database with a custom schema and import pragmas.
func openPartial(path string, ddl string) (*DB, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve path %s: %w", path, err)
	}
	sqlDB, err := sql.Open(sqliteDriverName, absPath)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", absPath, err)
	}
	sqlDB.SetMaxOpenConns(1)
	if _, err := sqlDB.Exec(ddl); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("apply schema %s: %w", absPath, err)
	}
	if _, err := sqlDB.Exec(`PRAGMA journal_mode = OFF`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("set journal mode %s: %w", absPath, err)
	}
	db := &DB{sql: sqlDB}
	if err := db.setImportPragmas(); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return db, nil
}

// SplitDBPaths returns the .db file paths for split-DB mode given a base path.
// E.g. "foo.db" → "foo_stats.db", "foo_index.db"
func SplitDBPaths(basePath string) (statsPath, indexPath string) {
	ext := filepath.Ext(basePath)
	base := basePath[:len(basePath)-len(ext)]
	return base + "_stats" + ext, base + "_index" + ext
}

// openSplitDBs opens separate stats and index databases for split-DB import mode.
func openSplitDBs(basePath string) (statsDB, indexDB *DB, err error) {
	statsPath, indexPath := SplitDBPaths(basePath)
	statsDB, err = openPartial(statsPath, schemaStats)
	if err != nil {
		return nil, nil, fmt.Errorf("open stats db: %w", err)
	}
	indexDB, err = openPartial(indexPath, schemaIndex)
	if err != nil {
		statsDB.Close()
		return nil, nil, fmt.Errorf("open index db: %w", err)
	}
	return statsDB, indexDB, nil
}

// Finalize restores safe pragma settings after import.
// Runs VACUUM to reclaim space from page splits caused by UPSERT operations,
// then switches from journal_mode=OFF to WAL for runtime read access.
func (db *DB) finalize() error {
	// VACUUM before switching journal mode — requires 2x DB size in free disk
	// space temporarily. Reclaims partial page fills from UPSERT page splits.
	if _, err := db.sql.Exec("VACUUM"); err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}

	pragmas := []string{
		"PRAGMA synchronous = NORMAL",
		"PRAGMA locking_mode = NORMAL",
		"PRAGMA journal_mode = WAL",
	}
	for _, p := range pragmas {
		if _, err := db.sql.Exec(p); err != nil {
			return fmt.Errorf("finalize pragma %q: %w", p, err)
		}
	}
	return nil
}

// statsKey is the composite key for position stats accumulation.
type statsKey struct {
	hash   int64
	moveID int16
}

// statsEntry pairs a statsKey with its accumulated statRow for sorted writing.
type statsEntry struct {
	key statsKey
	row statRow
}

// statRow accumulates result and Elo totals for one (position, move) pair.
// WhiteWins and BlackWins are always from white's perspective.
type statRow struct {
	WhiteWins int
	Draws     int
	BlackWins int
	TotalElo  int
	EloCount  int
}

// FileImportInfo records per-file statistics for one import run.
type FileImportInfo struct {
	Filename      string
	SizeBytes     int64
	GamesImported int // approximate: counted at parse time, before dedup
}

// IndexResult summarises a completed import run.
type IndexResult struct {
	GamesIndexed  int
	StatsRows     int
	IndexRows     int
	TotalDuration time.Duration
	FileStats     []FileImportInfo // per-file stats, populated by RunIndexer

	// Phase timing (populated by runPipeline).
	EncodeTime     time.Duration
	GamesWriteTime time.Duration
	StatsWriteTime time.Duration // background + final combined
	IndexWriteTime time.Duration // background + final combined
	SkippedDupes   int
	Workers        int
}

// IndexConfig controls import behaviour.
type IndexConfig struct {
	OutputPath      string
	Replace         bool
	SkipGameIndex   bool
	Workers         int
	BatchSize       int
	MaxPhase        int
	StatsFlushLimit int         // 0 = default (32M entries)
	Ctx           context.Context                    // nil = context.Background()
	ProgressFn      func(gamesProcessed, fileIdx int)  // called after each batch write; may be nil
	PhaseFn         func(phase string)                 // called when pipeline enters a new phase; may be nil
	PhaseProgressFn func(done, total int)              // called during stats/index/finalize writes with rows written / total rows; may be nil
	CurrentFileFn   func(fileIdx int)                  // called when parser starts a new file (0-based); may be nil
}

// moveLookup maps SAN strings to compact integer IDs for the stats table.
// Thread-safe for concurrent reads after construction; use GetOrAdd for
// concurrent writes during import.
type moveLookup struct {
	mu      sync.RWMutex
	sanToID map[string]int16
	idToSAN []string // index = move_id
}

// newMoveLookup creates an empty move lookup.
func newMoveLookup() *moveLookup {
	return &moveLookup{
		sanToID: make(map[string]int16, 4096),
	}
}

// GetOrAdd returns the integer ID for a SAN string, assigning a new ID if
// this is the first time the string is seen. Thread-safe.
func (ml *moveLookup) getOrAdd(san string) int16 {
	ml.mu.RLock()
	id, ok := ml.sanToID[san]
	ml.mu.RUnlock()
	if ok {
		return id
	}

	ml.mu.Lock()
	defer ml.mu.Unlock()
	// Double-check after acquiring write lock.
	if id, ok := ml.sanToID[san]; ok {
		return id
	}
	id = int16(len(ml.idToSAN))
	ml.sanToID[san] = id
	ml.idToSAN = append(ml.idToSAN, san)
	return id
}

// Len returns the number of unique moves in the lookup.
func (ml *moveLookup) count() int {
	ml.mu.RLock()
	defer ml.mu.RUnlock()
	return len(ml.idToSAN)
}

// Entries returns all (id, san) pairs for writing to the database.
func (ml *moveLookup) entries() []string {
	ml.mu.RLock()
	defer ml.mu.RUnlock()
	out := make([]string, len(ml.idToSAN))
	copy(out, ml.idToSAN)
	return out
}

// gameInsertCols is the number of columns per game row in the INSERT statement.
const gameInsertCols = 9

// gameChunkSize is the max rows per multi-row game INSERT (8 cols × 500 = 4000 params).
const gameChunkSize = 500

// statsChunkSize is the max rows per multi-row stats INSERT (literal SQL values).
// Tuned empirically — see benchmarking notes in architecture.md.
const statsChunkSize = 100

func buildGameSQL(n int) string {
	var sb strings.Builder
	sb.Grow(150 + n*20)
	sb.WriteString(`INSERT OR IGNORE INTO master_games (white, black, result, date, eco, elo_white, elo_black, moves_blob, fingerprint) VALUES `)
	for i := 0; i < n; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString("(?,?,?,?,?,?,?,?,?)")
	}
	sb.WriteString(" RETURNING id")
	return sb.String()
}

// statsUpsertSuffix is appended to literal stats INSERT for UPSERT behavior.
const statsUpsertSuffix = ` ON CONFLICT (position_hash, move_id) DO UPDATE SET wins = wins + excluded.wins, draws = draws + excluded.draws, losses = losses + excluded.losses, total_elo = total_elo + excluded.total_elo, elo_count = elo_count + excluded.elo_count`

// buildStatsLiteralSQL builds a multi-row INSERT with literal integer values
// embedded directly in the SQL string, eliminating all parameter binding CGo
// calls. If upsert is true, appends ON CONFLICT DO UPDATE clause.
func buildStatsLiteralSQL(entries []statsEntry, upsert bool) string {
	// Estimate: ~80 chars per row (7 integers + separators).
	var buf []byte
	buf = append(buf, "INSERT INTO master_position_stats (position_hash, move_id, wins, draws, losses, total_elo, elo_count) VALUES "...)
	for i, e := range entries {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = append(buf, '(')
		buf = strconv.AppendInt(buf, e.key.hash, 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, int64(e.key.moveID), 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, int64(e.row.WhiteWins), 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, int64(e.row.Draws), 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, int64(e.row.BlackWins), 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, int64(e.row.TotalElo), 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, int64(e.row.EloCount), 10)
		buf = append(buf, ')')
	}
	if upsert {
		buf = append(buf, statsUpsertSuffix...)
	}
	return string(buf)
}

// buildIndexLiteralSQL builds a multi-row INSERT OR IGNORE with literal values.
func buildIndexLiteralSQL(rows []indexRow) string {
	var buf []byte
	buf = append(buf, "INSERT OR IGNORE INTO master_position_game_index (position_hash, game_id) VALUES "...)
	for i, r := range rows {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = append(buf, '(')
		buf = strconv.AppendInt(buf, r.posHash, 10)
		buf = append(buf, ',')
		buf = strconv.AppendInt(buf, r.gameID, 10)
		buf = append(buf, ')')
	}
	return string(buf)
}

// Cached SQL string for full-size game INSERT chunks (prepared once, reused many times).
var gameFullSQL = buildGameSQL(gameChunkSize)

// WriteBatch writes a batch of encoded games and their aggregated position
// stats to the database in a single transaction. Uses multi-row INSERT
// statements to minimize SQLite round-trips.
// gameIDs is populated with the newly inserted game IDs (in the same order as
// games) so the caller can build game-index rows.
func (db *DB) writeBatch(ctx context.Context, games []encodedGame, gameIDs *[]int64) error {
	if len(games) == 0 {
		return nil
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	args := make([]any, 0, gameChunkSize*gameInsertCols)
	for start := 0; start < len(games); start += gameChunkSize {
		end := start + gameChunkSize
		if end > len(games) {
			end = len(games)
		}
		chunk := games[start:end]

		args = args[:0]
		for _, g := range chunk {
			fp := gameFingerprint(g.White, g.Black, g.Date, g.Result, g.MovesBlob)
			args = append(args, g.White, g.Black, g.Result, g.Date, g.ECO, g.EloWhite, g.EloBlack, g.MovesBlob, fp)
		}

		var sqlStr string
		if len(chunk) == gameChunkSize {
			sqlStr = gameFullSQL
		} else {
			sqlStr = buildGameSQL(len(chunk))
		}

		rows, err := tx.QueryContext(ctx, sqlStr, args...)
		if err != nil {
			return fmt.Errorf("insert games: %w", err)
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return fmt.Errorf("scan game id: %w", err)
			}
			if gameIDs != nil {
				*gameIDs = append(*gameIDs, id)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("game rows iteration: %w", err)
		}
		rows.Close()
	}

	return tx.Commit()
}

// WriteStats writes all position stats in a single transaction using
// literal SQL values (no parameter binding). Each chunk's integer values
// are embedded directly in the SQL string, eliminating CGo bind calls.
func (db *DB) writeStats(ctx context.Context, stats map[statsKey]statRow, progressFn func(done, total int)) error {
	if len(stats) == 0 {
		return nil
	}

	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	entries := make([]statsEntry, 0, len(stats))
	for k, v := range stats {
		entries = append(entries, statsEntry{key: k, row: v})
	}

	// Sort by primary key for sequential B-tree insertion.
	slices.SortFunc(entries, func(a, b statsEntry) int {
		if c := cmp.Compare(a.key.hash, b.key.hash); c != 0 {
			return c
		}
		return cmp.Compare(a.key.moveID, b.key.moveID)
	})

	total := len(entries)
	for start := 0; start < total; start += statsChunkSize {
		end := start + statsChunkSize
		if end > total {
			end = total
		}
		chunk := entries[start:end]
		sql := buildStatsLiteralSQL(chunk, true)
		if _, err := tx.ExecContext(ctx, sql); err != nil {
			return fmt.Errorf("upsert stats chunk: %w", err)
		}
		if progressFn != nil {
			progressFn(end, total)
		}
	}

	return tx.Commit()
}

// WriteStatsDirect writes all position stats using plain INSERT (no UPSERT)
// with literal SQL values (no parameter binding). This is only safe when the
// stats table is empty (fresh import with --replace) AND the caller guarantees
// all keys in the map are unique (which a Go map does).
func (db *DB) writeStatsDirect(ctx context.Context, stats map[statsKey]statRow, progressFn func(done, total int)) error {
	if len(stats) == 0 {
		return nil
	}

	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	entries := make([]statsEntry, 0, len(stats))
	for k, v := range stats {
		entries = append(entries, statsEntry{key: k, row: v})
	}

	// Sort by primary key for sequential B-tree insertion.
	slices.SortFunc(entries, func(a, b statsEntry) int {
		if c := cmp.Compare(a.key.hash, b.key.hash); c != 0 {
			return c
		}
		return cmp.Compare(a.key.moveID, b.key.moveID)
	})

	total := len(entries)
	for start := 0; start < total; start += statsChunkSize {
		end := start + statsChunkSize
		if end > total {
			end = total
		}
		chunk := entries[start:end]
		sql := buildStatsLiteralSQL(chunk, false)
		if _, err := tx.ExecContext(ctx, sql); err != nil {
			return fmt.Errorf("insert stats chunk: %w", err)
		}
		if progressFn != nil {
			progressFn(end, total)
		}
	}

	return tx.Commit()
}

// indexRow is a typed game-index entry, replacing [2]any to avoid interface
// boxing allocation and type-assertion overhead in sort comparators.
type indexRow struct {
	posHash int64
	gameID  int64
}

// indexChunkSize is the max rows per multi-row game index INSERT (2 cols × 100 = 200 params).
const indexChunkSize = 100

// WriteGameIndex inserts (position_hash, game_id) pairs using multi-row
// INSERT OR IGNORE (a position may appear multiple times in a game via
// repetition, but we only want one row per unique pair).
func (db *DB) writeGameIndex(ctx context.Context, rows []indexRow, progressFn func(done, total int)) error {
	if len(rows) == 0 {
		return nil
	}

	// Sort by primary key (position_hash, game_id) for sequential B-tree insertion.
	slices.SortFunc(rows, func(a, b indexRow) int {
		if c := cmp.Compare(a.posHash, b.posHash); c != 0 {
			return c
		}
		return cmp.Compare(a.gameID, b.gameID)
	})

	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	total := len(rows)
	for start := 0; start < total; start += indexChunkSize {
		end := start + indexChunkSize
		if end > total {
			end = total
		}
		chunk := rows[start:end]
		sql := buildIndexLiteralSQL(chunk)
		if _, err := tx.ExecContext(ctx, sql); err != nil {
			return fmt.Errorf("insert game index chunk: %w", err)
		}
		if progressFn != nil {
			progressFn(end, total)
		}
	}

	return tx.Commit()
}

// writeMoveLookup writes the move SAN → integer ID lookup table.
func (db *DB) writeMoveLookup(ctx context.Context, ml *moveLookup) error {
	entries := ml.entries()
	if len(entries) == 0 {
		return nil
	}

	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	stmt, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO master_move_lookup (move_id, move_san) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare move lookup: %w", err)
	}
	defer stmt.Close()

	for id, san := range entries {
		if _, err := stmt.ExecContext(ctx, int16(id), san); err != nil {
			return fmt.Errorf("insert move %d=%q: %w", id, san, err)
		}
	}

	return tx.Commit()
}

// GameCount returns the total number of games in the master database.
// Returns 0 if the database is empty or has not been indexed.
func (db *DB) GameCount() (int64, error) {
	var n int64
	err := db.sql.QueryRow(`SELECT COUNT(*) FROM master_games`).Scan(&n)
	return n, err
}

// ExistingFingerprints checks which of the given fingerprints already exist in
// master_games and returns a set of the existing ones. Used by append mode to
// pre-filter duplicate games before insertion.
func (db *DB) existingFingerprints(ctx context.Context, fps []int64) (map[int64]bool, error) {
	if len(fps) == 0 {
		return nil, nil
	}

	existing := make(map[int64]bool)

	// Query in chunks to avoid exceeding SQLite parameter limits.
	const chunkSize = 500
	for start := 0; start < len(fps); start += chunkSize {
		end := start + chunkSize
		if end > len(fps) {
			end = len(fps)
		}
		chunk := fps[start:end]

		var sb strings.Builder
		sb.WriteString(`SELECT fingerprint FROM master_games WHERE fingerprint IN (`)
		for i := range chunk {
			if i > 0 {
				sb.WriteByte(',')
			}
			sb.WriteByte('?')
		}
		sb.WriteByte(')')

		args := make([]any, len(chunk))
		for i, fp := range chunk {
			args[i] = fp
		}

		rows, err := db.sql.QueryContext(ctx, sb.String(), args...)
		if err != nil {
			return nil, fmt.Errorf("query fingerprints: %w", err)
		}
		for rows.Next() {
			var fp int64
			if err := rows.Scan(&fp); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan fingerprint: %w", err)
			}
			existing[fp] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("iterate fingerprints: %w", err)
		}
	}

	return existing, nil
}

// AllFingerprints returns all existing game fingerprints in the database.
// Used by append mode to pre-filter duplicate games before stats accumulation.
func (db *DB) allFingerprints(ctx context.Context) (map[int64]bool, error) {
	rows, err := db.sql.QueryContext(ctx, `SELECT fingerprint FROM master_games WHERE fingerprint IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("query fingerprints: %w", err)
	}
	defer rows.Close()

	fps := make(map[int64]bool)
	for rows.Next() {
		var fp int64
		if err := rows.Scan(&fp); err != nil {
			return nil, fmt.Errorf("scan fingerprint: %w", err)
		}
		fps[fp] = true
	}
	return fps, rows.Err()
}

// MaxGameID returns the highest game ID in the database, or 0 if empty.
// Used by append mode to continue AUTOINCREMENT from the right offset.
func (db *DB) maxGameID() (int64, error) {
	var id sql.NullInt64
	err := db.sql.QueryRow(`SELECT MAX(id) FROM master_games`).Scan(&id)
	if err != nil {
		return 0, err
	}
	if !id.Valid {
		return 0, nil
	}
	return id.Int64, nil
}

// loadMoveLookup reads the existing move lookup table into a moveLookup.
// Used by append mode to preserve move ID assignments from prior imports.
func (db *DB) loadMoveLookup() (*moveLookup, error) {
	ml := newMoveLookup()

	rows, err := db.sql.Query(`SELECT move_id, move_san FROM master_move_lookup ORDER BY move_id`)
	if err != nil {
		return nil, fmt.Errorf("query move lookup: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int16
		var san string
		if err := rows.Scan(&id, &san); err != nil {
			return nil, fmt.Errorf("scan move lookup: %w", err)
		}
		// Grow idToSAN slice to accommodate the ID.
		for int(id) >= len(ml.idToSAN) {
			ml.idToSAN = append(ml.idToSAN, "")
		}
		ml.idToSAN[id] = san
		ml.sanToID[san] = id
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate move lookup: %w", err)
	}

	return ml, nil
}

func (db *DB) applySchema() error {
	if _, err := db.sql.Exec(schema); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}

	// Migrate existing databases: add fingerprint column if missing.
	if err := db.migrateFingerprint(); err != nil {
		return fmt.Errorf("migrate fingerprint: %w", err)
	}

	// Journal mode set separately from CREATE TABLE. OFF during import for speed;
	// Finalize() switches to WAL before closing.
	if _, err := db.sql.Exec(`PRAGMA journal_mode = OFF`); err != nil {
		return fmt.Errorf("set journal mode: %w", err)
	}
	return nil
}

// migrateFingerprint adds the fingerprint column to master_games if it doesn't
// exist (for databases created before append support). Existing rows get NULL
// fingerprints, which are distinct in SQLite UNIQUE constraints — so old rows
// won't block new inserts, though re-importing old games will create duplicates
// until a full re-import is done.
func (db *DB) migrateFingerprint() error {
	rows, err := db.sql.Query(`PRAGMA table_info(master_games)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasFingerprint := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull int
		var dfltValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dfltValue, &pk); err != nil {
			return err
		}
		if name == "fingerprint" {
			hasFingerprint = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if !hasFingerprint {
		if _, err := db.sql.Exec(`ALTER TABLE master_games ADD COLUMN fingerprint INTEGER`); err != nil {
			return fmt.Errorf("add fingerprint column: %w", err)
		}
		if _, err := db.sql.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_games_fingerprint ON master_games(fingerprint)`); err != nil {
			return fmt.Errorf("create fingerprint index: %w", err)
		}
	}
	return nil
}

func (db *DB) setImportPragmas() error {
	pragmas := []string{
		"PRAGMA synchronous = OFF",
		"PRAGMA cache_size = -131072",    // 128 MB
		"PRAGMA temp_store = MEMORY",
		"PRAGMA mmap_size = 134217728",   // 128 MB
		"PRAGMA locking_mode = EXCLUSIVE", // no lock overhead per transaction
		"PRAGMA auto_vacuum = NONE",
	}
	for _, p := range pragmas {
		if _, err := db.sql.Exec(p); err != nil {
			return fmt.Errorf("pragma %q: %w", p, err)
		}
	}
	return nil
}

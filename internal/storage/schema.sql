-- Masterboard database schema.
-- All migrations are idempotent (IF NOT EXISTS).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(parent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
-- Enforce unique names at each level: among non-null parents the (parent_id, name) UNIQUE
-- table constraint handles it; for root folders (parent_id IS NULL) we need a partial index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_name_root ON folders(name) WHERE parent_id IS NULL;

CREATE TABLE IF NOT EXISTS games (
    id           TEXT PRIMARY KEY,
    white        TEXT NOT NULL DEFAULT '',
    black        TEXT NOT NULL DEFAULT '',
    white_elo    INTEGER,
    black_elo    INTEGER,
    result       TEXT NOT NULL DEFAULT '*',
    date         TEXT NOT NULL DEFAULT '',
    event        TEXT NOT NULL DEFAULT '',
    site         TEXT NOT NULL DEFAULT '',
    round        TEXT NOT NULL DEFAULT '',
    eco          TEXT NOT NULL DEFAULT '',
    opening      TEXT NOT NULL DEFAULT '',
    time_control TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'manual',
    source_id    TEXT,
    identity_hash TEXT,
    folder_id    TEXT REFERENCES folders(id) ON DELETE SET NULL,
    pgn          TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_games_white    ON games(white);
CREATE INDEX IF NOT EXISTS idx_games_black    ON games(black);
CREATE INDEX IF NOT EXISTS idx_games_date     ON games(date);
CREATE INDEX IF NOT EXISTS idx_games_eco      ON games(eco);
CREATE INDEX IF NOT EXISTS idx_games_source   ON games(source);
-- Unique constraint for deduplication of external games (by platform game ID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source_id ON games(source, source_id)
    WHERE source_id IS NOT NULL AND source_id != '';
-- idx_games_identity_hash is created by the migration in db.go (after ALTER TABLE adds the column)
-- so it is intentionally absent here to avoid failing on existing databases that predate the column.

CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS game_collections (
    game_id       TEXT NOT NULL REFERENCES games(id)       ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, collection_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS repertoires (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    colour      TEXT NOT NULL CHECK(colour IN ('white', 'black')),
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS repertoire_moves (
    id              TEXT PRIMARY KEY,
    repertoire_id   TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    parent_id       TEXT REFERENCES repertoire_moves(id) ON DELETE CASCADE,
    from_fen        TEXT NOT NULL,
    to_fen          TEXT NOT NULL,
    move_san        TEXT NOT NULL,
    move_uci        TEXT NOT NULL,
    move_order       INTEGER NOT NULL DEFAULT 0,
    nag              INTEGER,
    comment          TEXT NOT NULL DEFAULT '',
    shapes           TEXT NOT NULL DEFAULT '',
    is_transposition INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_repertoire_moves_repertoire ON repertoire_moves(repertoire_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_moves_parent     ON repertoire_moves(parent_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_moves_fen        ON repertoire_moves(repertoire_id, from_fen);

//go:build !purego_sqlite

package masterdb

import _ "github.com/mattn/go-sqlite3" // registers "sqlite3" driver

const sqliteDriverName = "sqlite3"

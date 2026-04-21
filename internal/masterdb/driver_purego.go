//go:build purego_sqlite

package masterdb

import _ "modernc.org/sqlite" // registers "sqlite" driver

const sqliteDriverName = "sqlite"

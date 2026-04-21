package storage

import (
	"database/sql"
	"errors"
	"strings"
)

// GetSetting returns the value for the given settings key, or "" if not set.
func (d *DB) GetSetting(key string) (string, error) {
	var value string
	err := d.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

// GetIdentityNames returns all player name variants configured in Settings:
// lichess username, chess.com username, and the identity.displayName lines.
// Used to determine which side the user played in a given game.
func (d *DB) GetIdentityNames() []string {
	var names []string
	for _, key := range []string{"lichess.username", "chesscom.username"} {
		v, _ := d.GetSetting(key)
		if v = strings.TrimSpace(v); v != "" {
			names = append(names, v)
		}
	}
	if display, _ := d.GetSetting("identity.displayName"); display != "" {
		for _, v := range strings.Split(display, "\n") {
			if v = strings.TrimSpace(v); v != "" {
				names = append(names, v)
			}
		}
	}
	return names
}

// SetSetting stores or updates a settings value by key.
func (d *DB) SetSetting(key, value string) error {
	_, err := d.db.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, now(),
	)
	return err
}

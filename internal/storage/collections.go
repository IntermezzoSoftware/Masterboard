package storage

import (
	"fmt"

	"github.com/google/uuid"
)

// Collection represents a named group of games.
type Collection struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ListCollections returns all collections ordered by name.
func (d *DB) ListCollections() ([]Collection, error) {
	rows, err := d.db.Query(`SELECT id, name, description FROM collections ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}
	defer rows.Close()

	cols := make([]Collection, 0)
	for rows.Next() {
		var c Collection
		if err := rows.Scan(&c.ID, &c.Name, &c.Description); err != nil {
			return nil, fmt.Errorf("scan collection: %w", err)
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

// CreateCollection creates a new collection with the given name and returns its ID.
func (d *DB) CreateCollection(name string) (string, error) {
	id := uuid.New().String()
	_, err := d.db.Exec(
		`INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)`,
		id, name, now(),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return "", fmt.Errorf("collection %q already exists", name)
		}
		return "", fmt.Errorf("create collection: %w", err)
	}
	return id, nil
}

// AddGameToCollection adds a game to a collection (idempotent).
func (d *DB) AddGameToCollection(gameID, collectionID string) error {
	_, err := d.db.Exec(
		`INSERT OR IGNORE INTO game_collections (game_id, collection_id) VALUES (?, ?)`,
		gameID, collectionID,
	)
	return err
}

// RemoveGameFromCollection removes a game from a collection.
func (d *DB) RemoveGameFromCollection(gameID, collectionID string) error {
	_, err := d.db.Exec(
		`DELETE FROM game_collections WHERE game_id = ? AND collection_id = ?`,
		gameID, collectionID,
	)
	return err
}

// ListGameCollections returns all collections that a given game belongs to.
func (d *DB) ListGameCollections(gameID string) ([]Collection, error) {
	rows, err := d.db.Query(`
		SELECT c.id, c.name, c.description
		FROM collections c
		JOIN game_collections gc ON c.id = gc.collection_id
		WHERE gc.game_id = ?
		ORDER BY c.name`, gameID)
	if err != nil {
		return nil, fmt.Errorf("list game collections: %w", err)
	}
	defer rows.Close()

	var cols []Collection
	for rows.Next() {
		var c Collection
		if err := rows.Scan(&c.ID, &c.Name, &c.Description); err != nil {
			return nil, fmt.Errorf("scan collection: %w", err)
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

// DeleteCollection removes a collection and all its game associations (via CASCADE).
func (d *DB) DeleteCollection(id string) error {
	res, err := d.db.Exec(`DELETE FROM collections WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete collection: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}


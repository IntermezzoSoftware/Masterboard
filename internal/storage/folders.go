package storage

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
)

// Folder represents a named folder in the game library hierarchy.
type Folder struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	ParentID *string `json:"parentId"`
}

// ListFolders returns all folders as a flat list ordered by name.
func (d *DB) ListFolders() ([]Folder, error) {
	rows, err := d.db.Query(`SELECT id, name, parent_id FROM folders ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	defer rows.Close()

	folders := make([]Folder, 0)
	for rows.Next() {
		var f Folder
		var parentID sql.NullString
		if err := rows.Scan(&f.ID, &f.Name, &parentID); err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		if parentID.Valid {
			s := parentID.String
			f.ParentID = &s
		}
		folders = append(folders, f)
	}
	return folders, rows.Err()
}

// CreateFolder creates a new folder and returns its ID.
// parentID may be nil to create a root-level folder.
func (d *DB) CreateFolder(name string, parentID *string) (string, error) {
	id := uuid.New().String()
	_, err := d.db.Exec(
		`INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)`,
		id, name, nullStringPtr(parentID), now(),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return "", fmt.Errorf("a folder named %q already exists here", name)
		}
		return "", fmt.Errorf("create folder: %w", err)
	}
	return id, nil
}

// RenameFolder changes the name of a folder.
func (d *DB) RenameFolder(id, name string) error {
	res, err := d.db.Exec(`UPDATE folders SET name=? WHERE id=?`, name, id)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("a folder named %q already exists here", name)
		}
		return fmt.Errorf("rename folder: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteFolder removes a folder by ID. Child folders are cascade-deleted.
// Games in the folder (or its descendants) become unfiled (folder_id set to NULL).
func (d *DB) DeleteFolder(id string) error {
	res, err := d.db.Exec(`DELETE FROM folders WHERE id=?`, id)
	if err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteFolderWithGames removes a folder and permanently deletes all games
// within it and any descendant folders. Child folders are cascade-deleted.
func (d *DB) DeleteFolderWithGames(id string) error {
	// Clean up position index rows for the games about to be deleted.
	for _, tbl := range []string{"position_game_index", "position_indexed_games"} {
		d.db.Exec(`
			WITH RECURSIVE subtree(id) AS (
				SELECT id FROM folders WHERE id = ?
				UNION ALL
				SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
			)
			DELETE FROM `+tbl+` WHERE game_id IN (
				SELECT id FROM games WHERE folder_id IN (SELECT id FROM subtree)
			)
		`, id) //nolint:errcheck
	}
	// position_stats is a pre-aggregated table and is not decremented per-game.
	// ReindexPersonalGames rebuilds it from scratch if needed.

	_, err := d.db.Exec(`
		WITH RECURSIVE subtree(id) AS (
			SELECT id FROM folders WHERE id = ?
			UNION ALL
			SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
		)
		DELETE FROM games WHERE folder_id IN (SELECT id FROM subtree)
	`, id)
	if err != nil {
		return fmt.Errorf("delete games in folder: %w", err)
	}
	return d.DeleteFolder(id)
}

// MoveGameToFolder sets the folder for a game. Pass nil to unfile the game.
func (d *DB) MoveGameToFolder(gameID string, folderID *string) error {
	res, err := d.db.Exec(`UPDATE games SET folder_id=? WHERE id=?`, nullStringPtr(folderID), gameID)
	if err != nil {
		return fmt.Errorf("move game to folder: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func nullStringPtr(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

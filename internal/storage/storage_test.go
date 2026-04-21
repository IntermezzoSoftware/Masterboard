package storage

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

// openTestDB opens a temp-file SQLite database for testing.
func openTestDB(t *testing.T) *DB {
	t.Helper()
	f, err := os.CreateTemp("", "masterboard-test-*.db")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	path := f.Name()
	f.Close()
	t.Cleanup(func() { os.Remove(path) })

	db, err := Open(path)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func sampleGame() game.GameInput {
	return game.GameInput{
		White:       "Alice",
		Black:       "Bob",
		Result:      "1-0",
		Date:        "2024.01.01",
		Event:       "Test Event",
		Site:        "",
		Round:       "",
		ECO:         "C60",
		Opening:     "Ruy Lopez",
		TimeControl: "600+0",
		Source:      "lichess",
		SourceID:    "test-source-id-123",
		// PGN reaches the Ruy Lopez position so ClassifyGame returns a known entry.
		PGN: "[White \"Alice\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0",
	}
}


func TestSaveAndGetGame(t *testing.T) {
	db := openTestDB(t)
	id, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty ID")
	}
	rec, err := db.GetGame(id)
	if err != nil {
		t.Fatalf("GetGame: %v", err)
	}
	if rec.White != "Alice" || rec.Black != "Bob" {
		t.Errorf("unexpected record: %+v", rec)
	}
	// SaveGame must classify from moves, not from the input struct's Opening field.
	// sampleGame() PGN reaches the Ruy Lopez (C60); the dataset uses "Ruy Lopez".
	if rec.Opening != "Ruy Lopez" {
		t.Errorf("expected Opening %q from ClassifyGame, got %q", "Ruy Lopez", rec.Opening)
	}
	if rec.ECO != "C60" {
		t.Errorf("expected ECO %q from ClassifyGame, got %q", "C60", rec.ECO)
	}
}

func TestGetGameNotFound(t *testing.T) {
	db := openTestDB(t)
	_, err := db.GetGame("nonexistent-id")
	if err == nil {
		t.Fatal("expected error for missing game")
	}
}

func TestSaveGameDuplicateReturnsError(t *testing.T) {
	db := openTestDB(t)
	g := sampleGame()
	if _, err := db.SaveGame(g); err != nil {
		t.Fatalf("first save: %v", err)
	}
	_, err := db.SaveGame(g)
	if err == nil {
		t.Fatal("expected duplicate error")
	}
}

func TestDeleteGame(t *testing.T) {
	db := openTestDB(t)
	id, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}
	if err := db.DeleteGame(id); err != nil {
		t.Fatalf("DeleteGame: %v", err)
	}
	_, err = db.GetGame(id)
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestUpdateGame(t *testing.T) {
	db := openTestDB(t)
	id, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}
	// Switch to a Queen's Pawn game — should reclassify eco/opening.
	newPGN := "[White \"Alice\"]\n\n1. d4 d5 1-0"
	if err := db.UpdateGame(id, newPGN); err != nil {
		t.Fatalf("UpdateGame: %v", err)
	}
	rec, err := db.GetGame(id)
	if err != nil {
		t.Fatalf("GetGame after update: %v", err)
	}
	if !strings.Contains(rec.PGN, "1. d4") {
		t.Errorf("expected updated PGN, got: %s", rec.PGN)
	}
	// eco/opening must be reclassified from the new moves (not the old Ruy Lopez values).
	if rec.ECO == "C60" {
		t.Errorf("expected eco to be reclassified away from C60 after PGN update")
	}
	if rec.Opening == "Ruy Lopez" {
		t.Errorf("expected opening to be reclassified away from Ruy Lopez after PGN update")
	}
}

func TestUpdateGameNotFound(t *testing.T) {
	db := openTestDB(t)
	if err := db.UpdateGame("nonexistent", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestUpdateGameMetadata(t *testing.T) {
	db := openTestDB(t)
	id, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	originalPGN := "[White \"Alice\"]\n\n1. e4 e5 1-0"
	whiteElo := 2200
	blackElo := 2100
	meta := game.GameMetadataInput{
		White:    "Carol",
		Black:    "Dave",
		WhiteElo: &whiteElo,
		BlackElo: &blackElo,
		Result:   "0-1",
		Date:     "2025.03.15",
		Event:    "Updated Event",
		Site:     "Updated Site",
		Round:    "3",
		ECO:      "D30",
	}
	if err := db.UpdateGameMetadata(id, meta); err != nil {
		t.Fatalf("UpdateGameMetadata: %v", err)
	}

	rec, err := db.GetGame(id)
	if err != nil {
		t.Fatalf("GetGame after UpdateGameMetadata: %v", err)
	}
	if rec.White != "Carol" {
		t.Errorf("White: got %q, want %q", rec.White, "Carol")
	}
	if rec.Black != "Dave" {
		t.Errorf("Black: got %q, want %q", rec.Black, "Dave")
	}
	if rec.WhiteElo == nil || *rec.WhiteElo != 2200 {
		t.Errorf("WhiteElo: got %v, want 2200", rec.WhiteElo)
	}
	if rec.BlackElo == nil || *rec.BlackElo != 2100 {
		t.Errorf("BlackElo: got %v, want 2100", rec.BlackElo)
	}
	if rec.Result != "0-1" {
		t.Errorf("Result: got %q, want %q", rec.Result, "0-1")
	}
	if rec.Date != "2025.03.15" {
		t.Errorf("Date: got %q, want %q", rec.Date, "2025.03.15")
	}
	if rec.Event != "Updated Event" {
		t.Errorf("Event: got %q, want %q", rec.Event, "Updated Event")
	}
	if rec.Site != "Updated Site" {
		t.Errorf("Site: got %q, want %q", rec.Site, "Updated Site")
	}
	if rec.Round != "3" {
		t.Errorf("Round: got %q, want %q", rec.Round, "3")
	}
	if rec.ECO != "D30" {
		t.Errorf("ECO: got %q, want %q", rec.ECO, "D30")
	}
	// PGN headers must be rewritten atomically alongside the metadata columns.
	if game.ExtractHeader(rec.PGN, "White") != "Carol" {
		t.Errorf("PGN White header not updated: got %q in PGN %q", game.ExtractHeader(rec.PGN, "White"), rec.PGN)
	}
	if game.ExtractHeader(rec.PGN, "Black") != "Dave" {
		t.Errorf("PGN Black header not updated: got %q in PGN %q", game.ExtractHeader(rec.PGN, "Black"), rec.PGN)
	}
	// The original PGN variable is kept for reference but the pgn column should differ.
	_ = originalPGN

	// identity_hash must be recomputed — FindDuplicateGame must still find the
	// game using the updated metadata and the rewritten PGN.
	dupID, err := db.FindDuplicateGame(game.GameInput{
		White:  "Carol",
		Black:  "Dave",
		Date:   "2025.03.15",
		Result: "0-1",
		PGN:    rec.PGN,
	})
	if err != nil {
		t.Fatalf("FindDuplicateGame after UpdateGameMetadata: %v", err)
	}
	if dupID != id {
		t.Errorf("FindDuplicateGame: expected %q, got %q — identity_hash not recomputed", id, dupID)
	}

	// ErrNotFound for a nonexistent ID
	if err := db.UpdateGameMetadata("nonexistent", meta); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound for nonexistent ID, got %v", err)
	}
}

// TestClassificationOverride verifies that UpdateGameMetadata locks eco/opening
// when either field is explicitly set, and that UpdateGame respects that lock.
func TestClassificationOverride(t *testing.T) {
	t.Run("ECO set locks both fields from UpdateGame", func(t *testing.T) {
		db := openTestDB(t)
		id, err := db.SaveGame(sampleGame())
		if err != nil {
			t.Fatalf("SaveGame: %v", err)
		}
		// User explicitly sets ECO; Opening is left blank so it gets auto-filled.
		whiteElo := 2000
		meta := game.GameMetadataInput{
			White: "Alice", Black: "Bob",
			WhiteElo: &whiteElo, Result: "1-0", Date: "2024.01.01",
			Event: "Test Event",
			ECO:   "E00", // intentionally different from the game's actual moves
		}
		if err := db.UpdateGameMetadata(id, meta); err != nil {
			t.Fatalf("UpdateGameMetadata: %v", err)
		}
		rec, err := db.GetGame(id)
		if err != nil {
			t.Fatalf("GetGame after UpdateGameMetadata: %v", err)
		}
		if rec.ECO != "E00" {
			t.Errorf("ECO: expected user's %q, got %q", "E00", rec.ECO)
		}

		// Now update the PGN — locked game must not lose the user's ECO.
		newPGN := "[White \"Alice\"]\n\n1. d4 d5 1-0"
		if err := db.UpdateGame(id, newPGN); err != nil {
			t.Fatalf("UpdateGame after override: %v", err)
		}
		rec, err = db.GetGame(id)
		if err != nil {
			t.Fatalf("GetGame after UpdateGame: %v", err)
		}
		if rec.ECO != "E00" {
			t.Errorf("ECO must be preserved after UpdateGame when overridden; got %q", rec.ECO)
		}
	})

	t.Run("Opening set locks both fields from UpdateGame", func(t *testing.T) {
		db := openTestDB(t)
		id, err := db.SaveGame(sampleGame())
		if err != nil {
			t.Fatalf("SaveGame: %v", err)
		}
		whiteElo := 2000
		meta := game.GameMetadataInput{
			White: "Alice", Black: "Bob",
			WhiteElo: &whiteElo, Result: "1-0", Date: "2024.01.01",
			Event:   "Test Event",
			Opening: "My Custom Opening",
		}
		if err := db.UpdateGameMetadata(id, meta); err != nil {
			t.Fatalf("UpdateGameMetadata: %v", err)
		}
		rec, err := db.GetGame(id)
		if err != nil {
			t.Fatalf("GetGame after UpdateGameMetadata: %v", err)
		}
		if rec.Opening != "My Custom Opening" {
			t.Errorf("Opening: expected %q, got %q", "My Custom Opening", rec.Opening)
		}

		newPGN := "[White \"Alice\"]\n\n1. d4 d5 1-0"
		if err := db.UpdateGame(id, newPGN); err != nil {
			t.Fatalf("UpdateGame after override: %v", err)
		}
		rec, err = db.GetGame(id)
		if err != nil {
			t.Fatalf("GetGame after UpdateGame: %v", err)
		}
		if rec.Opening != "My Custom Opening" {
			t.Errorf("Opening must be preserved after UpdateGame when overridden; got %q", rec.Opening)
		}
	})

	t.Run("clearing both ECO and Opening resets auto-classify", func(t *testing.T) {
		db := openTestDB(t)
		id, err := db.SaveGame(sampleGame())
		if err != nil {
			t.Fatalf("SaveGame: %v", err)
		}
		// First: set an override.
		whiteElo := 2000
		meta := game.GameMetadataInput{
			White: "Alice", Black: "Bob",
			WhiteElo: &whiteElo, Result: "1-0", Date: "2024.01.01",
			Event: "Test Event",
			ECO:   "E00", Opening: "Custom",
		}
		if err := db.UpdateGameMetadata(id, meta); err != nil {
			t.Fatalf("UpdateGameMetadata (set override): %v", err)
		}
		// Then: clear both — resets the lock.
		meta.ECO = ""
		meta.Opening = ""
		if err := db.UpdateGameMetadata(id, meta); err != nil {
			t.Fatalf("UpdateGameMetadata (clear override): %v", err)
		}

		// UpdateGame must now reclassify from moves.
		newPGN := "[White \"Alice\"]\n\n1. d4 d5 1-0"
		if err := db.UpdateGame(id, newPGN); err != nil {
			t.Fatalf("UpdateGame after clearing override: %v", err)
		}
		rec, err := db.GetGame(id)
		if err != nil {
			t.Fatalf("GetGame after UpdateGame: %v", err)
		}
		if rec.ECO == "E00" {
			t.Errorf("ECO must be reclassified after override was cleared; still %q", rec.ECO)
		}
		if rec.Opening == "Custom" {
			t.Errorf("Opening must be reclassified after override was cleared; still %q", rec.Opening)
		}
	})
}

func TestListGames(t *testing.T) {
	db := openTestDB(t)
	g1 := sampleGame()
	g2 := sampleGame()
	g2.White = "Carol"
	g2.SourceID = "test-source-id-456"
	g2.PGN = "[White \"Carol\"]\n\n1. d4 d5 1-0"
	if _, err := db.SaveGame(g1); err != nil {
		t.Fatalf("SaveGame g1: %v", err)
	}
	if _, err := db.SaveGame(g2); err != nil {
		t.Fatalf("SaveGame g2: %v", err)
	}
	games, err := db.ListGames(game.GameFilters{})
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("expected 2 games, got %d", len(games))
	}
}

func TestListGamesFilterByResult(t *testing.T) {
	db := openTestDB(t)
	g1 := sampleGame()
	g2 := sampleGame()
	g2.Result = "0-1"
	g2.SourceID = "test-source-id-789"
	g2.PGN = "[White \"Alice\"]\n[Result \"0-1\"]\n\n1. e4 e5 0-1"
	db.SaveGame(g1) //nolint:errcheck
	db.SaveGame(g2) //nolint:errcheck

	games, err := db.ListGames(game.GameFilters{Result: "1-0"})
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game with result 1-0, got %d", len(games))
	}
}

func TestListGamesNoLimit(t *testing.T) {
	db := openTestDB(t)
	for i := 0; i < 5; i++ {
		g := sampleGame()
		g.White = fmt.Sprintf("Player-%d", i)
		g.SourceID = fmt.Sprintf("no-limit-%d", i)
		g.PGN = fmt.Sprintf("[White \"Player-%d\"]\n\n1. e4 e5 1-0", i)
		db.SaveGame(g) //nolint:errcheck
	}

	games, err := db.ListGames(game.GameFilters{Limit: -1})
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(games) != 5 {
		t.Fatalf("expected 5 games with Limit:-1, got %d", len(games))
	}
}

func TestListGamesFilterByPlayerNames(t *testing.T) {
	db := openTestDB(t)
	g1 := sampleGame()
	g1.White = "Alice"
	g1.Black = "Bob"
	g1.SourceID = "pn-1"
	db.SaveGame(g1) //nolint:errcheck

	g2 := sampleGame()
	g2.White = "Charlie"
	g2.Black = "Diana"
	g2.SourceID = "pn-2"
	g2.PGN = "[White \"Charlie\"]\n[Black \"Diana\"]\n[Result \"1-0\"]\n\n1. d4 d5 1-0"
	db.SaveGame(g2) //nolint:errcheck

	g3 := sampleGame()
	g3.White = "Eve"
	g3.Black = "alice"
	g3.SourceID = "pn-3"
	g3.PGN = "[White \"Eve\"]\n[Black \"alice\"]\n[Result \"0-1\"]\n\n1. c4 e5 0-1"
	db.SaveGame(g3) //nolint:errcheck

	// Filter for Alice (case-insensitive) — should match g1 (white) and g3 (black)
	games, err := db.ListGames(game.GameFilters{PlayerNames: []string{"Alice"}, Limit: -1})
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("expected 2 games for PlayerNames=[Alice], got %d", len(games))
	}
}


func TestGetSettingMissing(t *testing.T) {
	db := openTestDB(t)
	val, err := db.GetSetting("nonexistent")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if val != "" {
		t.Errorf("expected empty string, got %q", val)
	}
}

func TestSetAndGetSetting(t *testing.T) {
	db := openTestDB(t)
	if err := db.SetSetting("mykey", "myvalue"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	val, err := db.GetSetting("mykey")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if val != "myvalue" {
		t.Errorf("expected %q, got %q", "myvalue", val)
	}
}

func TestSetSettingOverwrite(t *testing.T) {
	db := openTestDB(t)
	db.SetSetting("k", "first")  //nolint:errcheck
	db.SetSetting("k", "second") //nolint:errcheck
	val, _ := db.GetSetting("k")
	if val != "second" {
		t.Errorf("expected %q after overwrite, got %q", "second", val)
	}
}


func TestCreateAndListCollections(t *testing.T) {
	db := openTestDB(t)
	id, err := db.CreateCollection("Favourites")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty ID")
	}
	cols, err := db.ListCollections()
	if err != nil {
		t.Fatalf("ListCollections: %v", err)
	}
	if len(cols) != 1 || cols[0].Name != "Favourites" {
		t.Errorf("unexpected collections: %+v", cols)
	}
}

func TestCreateCollectionDuplicateReturnsError(t *testing.T) {
	db := openTestDB(t)
	if _, err := db.CreateCollection("Dup"); err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err := db.CreateCollection("Dup")
	if err == nil {
		t.Fatal("expected error for duplicate collection name")
	}
}

func TestDeleteCollection(t *testing.T) {
	db := openTestDB(t)
	id, _ := db.CreateCollection("ToDelete")
	if err := db.DeleteCollection(id); err != nil {
		t.Fatalf("DeleteCollection: %v", err)
	}
	cols, _ := db.ListCollections()
	if len(cols) != 0 {
		t.Errorf("expected 0 collections after delete, got %d", len(cols))
	}
}

func TestDeleteCollectionNotFound(t *testing.T) {
	db := openTestDB(t)
	if err := db.DeleteCollection("nonexistent"); err == nil {
		t.Fatal("expected ErrNotFound for missing collection")
	}
}

func TestAddRemoveGameFromCollection(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	collID, _ := db.CreateCollection("Study")

	if err := db.AddGameToCollection(gameID, collID); err != nil {
		t.Fatalf("AddGameToCollection: %v", err)
	}

	// ListGameCollections should return the collection.
	cols, err := db.ListGameCollections(gameID)
	if err != nil {
		t.Fatalf("ListGameCollections: %v", err)
	}
	if len(cols) != 1 || cols[0].ID != collID {
		t.Errorf("expected game to be in collection, got: %+v", cols)
	}

	// AddGameToCollection is idempotent.
	if err := db.AddGameToCollection(gameID, collID); err != nil {
		t.Fatalf("second AddGameToCollection: %v", err)
	}
	cols2, _ := db.ListGameCollections(gameID)
	if len(cols2) != 1 {
		t.Errorf("expected 1 collection after idempotent add, got %d", len(cols2))
	}

	// Remove it.
	if err := db.RemoveGameFromCollection(gameID, collID); err != nil {
		t.Fatalf("RemoveGameFromCollection: %v", err)
	}
	cols3, _ := db.ListGameCollections(gameID)
	if len(cols3) != 0 {
		t.Errorf("expected 0 collections after remove, got %d", len(cols3))
	}
}

func TestListGamesIncludesCollectionNames(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	collID, _ := db.CreateCollection("Opening Study")
	db.AddGameToCollection(gameID, collID) //nolint:errcheck

	games, err := db.ListGames(game.GameFilters{})
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(games) != 1 {
		t.Fatalf("expected 1 game, got %d", len(games))
	}
	if len(games[0].CollectionNames) != 1 || games[0].CollectionNames[0] != "Opening Study" {
		t.Errorf("unexpected CollectionNames: %+v", games[0].CollectionNames)
	}
}

func TestListGamesFilterByCollectionID(t *testing.T) {
	db := openTestDB(t)
	g1 := sampleGame()
	g2 := sampleGame()
	g2.SourceID = "alt-src"
	g2.White = "Carol"
	id1, _ := db.SaveGame(g1)
	id2, _ := db.SaveGame(g2)

	collID, _ := db.CreateCollection("Annotated")
	db.AddGameToCollection(id1, collID) //nolint:errcheck

	// Filter by collection — should return only g1.
	games, err := db.ListGames(game.GameFilters{CollectionID: collID})
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(games) != 1 || games[0].ID != id1 {
		t.Errorf("expected only game %s in collection, got: %+v", id1, games)
	}
	_ = id2 // g2 is not in the collection
}


func TestCreateFolder(t *testing.T) {
	db := openTestDB(t)
	id, err := db.CreateFolder("Tournaments", nil)
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty ID")
	}
	// create child folder
	childID, err := db.CreateFolder("2024", &id)
	if err != nil {
		t.Fatalf("CreateFolder child: %v", err)
	}
	if childID == "" {
		t.Fatal("expected non-empty child ID")
	}
	// duplicate name at same level fails
	_, err = db.CreateFolder("Tournaments", nil)
	if err == nil {
		t.Fatal("expected error for duplicate folder name at root level")
	}
	// same name under a different parent is allowed
	_, err = db.CreateFolder("Tournaments", &id)
	if err != nil {
		t.Fatalf("expected duplicate name under different parent to succeed: %v", err)
	}
}

func TestRenameFolder(t *testing.T) {
	db := openTestDB(t)
	id, _ := db.CreateFolder("OldName", nil)
	if err := db.RenameFolder(id, "NewName"); err != nil {
		t.Fatalf("RenameFolder: %v", err)
	}
	sib, _ := db.CreateFolder("Sibling", nil)
	// cannot rename to a sibling's name
	if err := db.RenameFolder(sib, "NewName"); err == nil {
		t.Fatal("expected error renaming to existing sibling name")
	}
	// not found
	if err := db.RenameFolder("nonexistent", "X"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteFolder(t *testing.T) {
	db := openTestDB(t)
	parentID, _ := db.CreateFolder("Parent", nil)
	_, _ = db.CreateFolder("Child", &parentID)

	gameID, _ := db.SaveGame(sampleGame())
	if err := db.MoveGameToFolder(gameID, &parentID); err != nil {
		t.Fatalf("MoveGameToFolder: %v", err)
	}

	// delete parent: child also deleted, game becomes unfiled
	if err := db.DeleteFolder(parentID); err != nil {
		t.Fatalf("DeleteFolder: %v", err)
	}

	// game still exists but has no folder
	rec, err := db.GetGame(gameID)
	if err != nil {
		t.Fatalf("GetGame after folder delete: %v", err)
	}
	if rec.FolderID != nil {
		t.Errorf("expected game to be unfiled after folder delete, got folder %v", *rec.FolderID)
	}

	// folders list should be empty
	folders, _ := db.ListFolders()
	if len(folders) != 0 {
		t.Errorf("expected 0 folders after cascade delete, got %d", len(folders))
	}

	// not found
	if err := db.DeleteFolder("nonexistent"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestMoveGameToFolder(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	folderID, _ := db.CreateFolder("Study", nil)

	if err := db.MoveGameToFolder(gameID, &folderID); err != nil {
		t.Fatalf("MoveGameToFolder: %v", err)
	}
	rec, _ := db.GetGame(gameID)
	if rec.FolderID == nil || *rec.FolderID != folderID {
		t.Errorf("expected FolderID %q, got %v", folderID, rec.FolderID)
	}

	// move to nil (unfile)
	if err := db.MoveGameToFolder(gameID, nil); err != nil {
		t.Fatalf("MoveGameToFolder to nil: %v", err)
	}
	rec2, _ := db.GetGame(gameID)
	if rec2.FolderID != nil {
		t.Errorf("expected FolderID nil after unfiling, got %v", rec2.FolderID)
	}
}

func TestListGamesFilterByFolder(t *testing.T) {
	db := openTestDB(t)

	parentID, _ := db.CreateFolder("Parent", nil)
	childID, _ := db.CreateFolder("Child", &parentID)

	g1 := sampleGame()
	g2 := sampleGame()
	g2.SourceID = "src-456"
	g2.White = "Carol"
	g3 := sampleGame()
	g3.SourceID = "src-789"
	g3.White = "Dave"

	id1, _ := db.SaveGame(g1)
	id2, _ := db.SaveGame(g2)
	id3, _ := db.SaveGame(g3)

	db.MoveGameToFolder(id1, &parentID) //nolint:errcheck
	db.MoveGameToFolder(id2, &childID)  //nolint:errcheck
	// id3 is unfiled

	// exact folder (parent only)
	games, _ := db.ListGames(game.GameFilters{FolderID: parentID, IncludeSubfolders: false})
	if len(games) != 1 || games[0].ID != id1 {
		t.Errorf("expected 1 game in parent folder, got %d: %v", len(games), games)
	}

	// parent + subfolders
	games2, _ := db.ListGames(game.GameFilters{FolderID: parentID, IncludeSubfolders: true})
	if len(games2) != 2 {
		t.Errorf("expected 2 games in parent+children, got %d", len(games2))
	}

	// unfiled
	games3, _ := db.ListGames(game.GameFilters{Unfiled: true})
	if len(games3) != 1 || games3[0].ID != id3 {
		t.Errorf("expected 1 unfiled game, got %d", len(games3))
	}
	_ = id3
}

func TestDeleteCollectionCascadesGameMemberships(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	collID, _ := db.CreateCollection("Temp")
	db.AddGameToCollection(gameID, collID) //nolint:errcheck

	db.DeleteCollection(collID) //nolint:errcheck

	// After cascade delete the game should still exist, just with no collections.
	cols, err := db.ListGameCollections(gameID)
	if err != nil {
		t.Fatalf("ListGameCollections after cascade: %v", err)
	}
	if len(cols) != 0 {
		t.Errorf("expected 0 collections after cascade delete, got %d", len(cols))
	}
}


func TestFindDuplicateGame_NoMatch(t *testing.T) {
	db := openTestDB(t)
	id, err := db.FindDuplicateGame(sampleGame())
	if err != nil {
		t.Fatalf("FindDuplicateGame: %v", err)
	}
	if id != "" {
		t.Errorf("expected empty ID for no match, got %q", id)
	}
}

func TestFindDuplicateGame_Match(t *testing.T) {
	db := openTestDB(t)
	savedID, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}
	foundID, err := db.FindDuplicateGame(sampleGame())
	if err != nil {
		t.Fatalf("FindDuplicateGame: %v", err)
	}
	if foundID != savedID {
		t.Errorf("expected %q, got %q", savedID, foundID)
	}
}

func TestSaveGame_IdentityHashDedupPreventsInsert(t *testing.T) {
	db := openTestDB(t)
	// Use source=manual with no SourceID so only the identity_hash constraint applies.
	g := sampleGame()
	g.Source = "manual"
	g.SourceID = ""
	if _, err := db.SaveGame(g); err != nil {
		t.Fatalf("first save: %v", err)
	}
	_, err := db.SaveGame(g)
	if !errors.Is(err, ErrDuplicate) {
		t.Errorf("expected ErrDuplicate from identity_hash UNIQUE constraint, got %v", err)
	}
}

func TestBackfillIdentityHash(t *testing.T) {
	db := openTestDB(t)
	// Insert a row bypassing SaveGame so identity_hash stays NULL, simulating
	// a game that existed before this column was added.
	id := "backfill-test-id"
	_, err := db.db.Exec(
		`INSERT INTO games (id, white, black, result, date, pgn, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
		id, "Alice", "Bob", "1-0", "2024.01.01",
		"[White \"Alice\"]\n\n1. e4 e5 1-0",
	)
	if err != nil {
		t.Fatalf("raw insert: %v", err)
	}

	if err := db.backfillIdentityHash(); err != nil {
		t.Fatalf("backfillIdentityHash: %v", err)
	}

	var h string
	db.db.QueryRow(`SELECT identity_hash FROM games WHERE id = ?`, id).Scan(&h) //nolint:errcheck
	if h == "" {
		t.Error("expected identity_hash to be set after backfill")
	}
}

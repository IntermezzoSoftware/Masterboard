package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// newTestApp creates an App with a temporary database for testing.
func newTestApp(t *testing.T) *App {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv("APPDATA", tmpDir)
	t.Setenv("HOME", tmpDir)
	_ = os.MkdirAll(filepath.Join(tmpDir, "Masterboard"), 0o755)
	app := NewApp()
	app.ctx = context.Background()
	t.Cleanup(func() { app.shutdown(context.Background()) })
	return app
}

func TestNewApp(t *testing.T) {
	app := NewApp()
	if app == nil {
		t.Fatal("NewApp() returned nil")
	}
}

func TestStartup(t *testing.T) {
	// Use a temp directory so we don't hit the real DB or stored window geometry.
	tmpDir := t.TempDir()
	t.Setenv("APPDATA", tmpDir)
	t.Setenv("HOME", tmpDir)
	// On Windows UserConfigDir uses APPDATA; create the expected subdir.
	_ = os.MkdirAll(filepath.Join(tmpDir, "Masterboard"), 0o755)

	app := NewApp()
	app.emitFn = func(string, any) {} // no-op: plain ctx has no Wails runtime
	t.Cleanup(func() { app.shutdown(context.Background()) })
	ctx := context.Background()
	// startup with a background context is fine as long as there is no
	// saved window geometry (which there isn't in the temp DB).
	app.startup(ctx)
	if app.ctx != ctx {
		t.Error("startup() did not store context")
	}
}

func TestShutdown(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("APPDATA", tmpDir)
	t.Setenv("HOME", tmpDir)
	_ = os.MkdirAll(filepath.Join(tmpDir, "Masterboard"), 0o755)

	app := NewApp()
	app.emitFn = func(string, any) {} // no-op: plain ctx has no Wails runtime
	ctx := context.Background()
	app.startup(ctx)
	// shutdown should complete without panic
	app.shutdown(ctx)
}

func TestImportPGNFolder(t *testing.T) {
	app := newTestApp(t)

	// Create a temp folder with two PGN files and one non-PGN file.
	dir := t.TempDir()
	pgn1 := `[White "Alice"][Black "Bob"][Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`
	pgn2 := `[White "Carol"][Black "Dave"][Result "0-1"]

1. d4 d5 2. c4 c6 0-1`
	if err := os.WriteFile(filepath.Join(dir, "game1.pgn"), []byte(pgn1), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "game2.PGN"), []byte(pgn2), 0o644); err != nil { // upper-case extension
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("ignore me"), 0o644); err != nil {
		t.Fatal(err)
	}

	ids, err := app.ImportPGNFolder(dir)
	if err != nil {
		t.Fatalf("ImportPGNFolder: %v", err)
	}
	if len(ids) != 2 {
		t.Errorf("expected 2 imported games, got %d", len(ids))
	}

	// Re-importing the same folder should skip duplicates and return 0 new IDs.
	ids2, err := app.ImportPGNFolder(dir)
	if err != nil {
		t.Fatalf("ImportPGNFolder (second run): %v", err)
	}
	if len(ids2) != 0 {
		t.Errorf("expected 0 new games on second import, got %d", len(ids2))
	}
}

func TestImportPGNFolderSkipsBadFiles(t *testing.T) {
	app := newTestApp(t)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad.pgn"), []byte("not pgn at all %%%"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A bad file should not return an error — it is skipped with a log message.
	_, err := app.ImportPGNFolder(dir)
	if err != nil {
		t.Errorf("expected no error for bad file, got: %v", err)
	}
}

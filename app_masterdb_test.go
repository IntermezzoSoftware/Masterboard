package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestGetMasterDBStatus_NotConfigured(t *testing.T) {
	app := newTestApp(t)
	status, err := app.GetMasterDBStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "not-configured" {
		t.Errorf("expected not-configured, got %q", status.State)
	}
	if status.TotalGames != 0 {
		t.Errorf("expected 0 total games, got %d", status.TotalGames)
	}
}

func TestStartMasterDBImport_NoFiles(t *testing.T) {
	app := newTestApp(t)
	err := app.StartMasterDBImport([]string{}, false)
	if err == nil {
		t.Error("expected error for empty file list")
	}
}

func TestStartMasterDBImport_AlreadyRunning(t *testing.T) {
	app := newTestApp(t)
	// Manually set importCancel to simulate an in-progress import.
	_, cancel := context.WithCancel(context.Background())
	app.masterDBMu.Lock()
	app.importCancel = cancel
	app.masterDBMu.Unlock()
	defer cancel()

	err := app.StartMasterDBImport([]string{"/fake/file.pgn"}, false)
	if err == nil {
		t.Error("expected error when import already running")
	}
}

func TestCancelMasterDBImport_WhenIdle(t *testing.T) {
	app := newTestApp(t)
	if err := app.CancelMasterDBImport(); err != nil {
		t.Errorf("unexpected error when cancelling idle import: %v", err)
	}
}

func TestGetFileSizes(t *testing.T) {
	dir := t.TempDir()

	// Create two temp files with known content.
	f1 := filepath.Join(dir, "a.pgn")
	f2 := filepath.Join(dir, "b.pgn")
	if err := os.WriteFile(f1, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f2, []byte("world!"), 0644); err != nil {
		t.Fatal(err)
	}

	app := newTestApp(t)
	sizes := app.GetFileSizes([]string{f1, f2, "/nonexistent/path.pgn"})
	if len(sizes) != 3 {
		t.Fatalf("expected 3 sizes, got %d", len(sizes))
	}
	if sizes[0] != 5 {
		t.Errorf("f1 size: got %d, want 5", sizes[0])
	}
	if sizes[1] != 6 {
		t.Errorf("f2 size: got %d, want 6", sizes[1])
	}
	if sizes[2] != 0 {
		t.Errorf("nonexistent size: got %d, want 0", sizes[2])
	}
}

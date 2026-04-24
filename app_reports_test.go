package main

import "testing"

// TestGetDeviationPositions_NoMasterDB guards against the typed-nil interface
// bug that broke the Reports page on macOS installs without an imported master
// database. The app stores masterDB as a concrete *masterdb.DB; passing that
// directly into a function taking the storage.MasterDB interface would produce
// an interface value whose type is non-nil while its value is nil, causing the
// `mdb == nil` guard to fail and the subsequent method call to panic.
func TestGetDeviationPositions_NoMasterDB(t *testing.T) {
	app := newTestApp(t)
	if app.masterDB != nil {
		t.Fatal("precondition: expected masterDB to be nil on a fresh test app")
	}

	rows, err := app.GetDeviationPositions([]string{"Magnus Carlsen"})
	if err != nil {
		t.Fatalf("GetDeviationPositions returned error with no master DB: %v", err)
	}
	if rows == nil {
		t.Error("expected non-nil slice so the Wails binding serializes to [], not null")
	}
	if len(rows) != 0 {
		t.Errorf("expected empty slice, got %d rows", len(rows))
	}
}

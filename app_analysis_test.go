package main

import (
	"sync"
	"testing"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

// emittedEvent captures an event name + payload from the mock emitFn.
type emittedEvent struct {
	Name string
	Data any
}

// waitForAnalysisDone polls until analysisCancel is nil (workers finished)
// or until the deadline is reached. Returns true if workers finished.
func waitForAnalysisDone(app *App, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		app.analysisMu.Lock()
		done := app.analysisCancel == nil
		app.analysisMu.Unlock()
		if done {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

// TestAnalyseGamesDoesNotDeadlock verifies that AnalyseGames returns promptly
// without deadlocking. The root cause of the analysis-never-starts bug was
// that emitQueueUpdate() tried to re-lock analysisMu while it was already held.
func TestAnalyseGamesDoesNotDeadlock(t *testing.T) {
	app := newTestApp(t)

	// Set enginePath to nonexistent — we don't care about engine launch here,
	// just that AnalyseGames returns without deadlocking.
	app.slot1.mu.Lock()
	app.slot1.path = "/nonexistent/engine-binary"
	app.slot1.mu.Unlock()

	app.emitFn = func(string, any) {}

	gameID, err := app.db.SaveGame(game.GameInput{
		White: "Alice", Black: "Bob", Result: "1-0",
		Date: "2024.01.01", Source: "test", SourceID: "deadlock-test-1",
		PGN: "[White \"Alice\"]\n[Black \"Bob\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0",
	})
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	// AnalyseGames must return within 2 seconds (it should be nearly instant).
	done := make(chan error, 1)
	go func() { done <- app.AnalyseGames([]string{gameID}) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("AnalyseGames: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("AnalyseGames deadlocked — did not return within 2 seconds")
	}
}

// TestAnalysisWorkerEngineFailure verifies that when the engine binary is
// missing (launch fails), every queued game gets status "error" in the DB
// and an analysis:complete event is emitted.
func TestAnalysisWorkerEngineFailure(t *testing.T) {
	app := newTestApp(t)

	app.slot1.mu.Lock()
	app.slot1.path = "/nonexistent/engine-binary"
	app.slot1.mu.Unlock()

	var mu sync.Mutex
	var events []emittedEvent
	app.emitFn = func(name string, data any) {
		mu.Lock()
		events = append(events, emittedEvent{Name: name, Data: data})
		mu.Unlock()
	}

	gameID, err := app.db.SaveGame(game.GameInput{
		White: "Alice", Black: "Bob", Result: "1-0",
		Date: "2024.01.01", Source: "test", SourceID: "engine-fail-test-1",
		PGN: "[White \"Alice\"]\n[Black \"Bob\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0",
	})
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	if err := app.AnalyseGame(gameID); err != nil {
		t.Fatalf("AnalyseGame: %v", err)
	}

	if !waitForAnalysisDone(app, 5*time.Second) {
		t.Fatal("workers did not finish within 5 seconds")
	}

	// The game's DB status must be "error", not stuck at "pending".
	rec, err := app.db.GetGameAnalysis(gameID)
	if err != nil {
		t.Fatalf("GetGameAnalysis: %v", err)
	}
	if rec == nil {
		t.Fatal("expected analysis record, got nil")
	}
	if rec.Status != "error" {
		t.Errorf("game status = %q, want %q", rec.Status, "error")
	}

	// An analysis:complete event must have been emitted for this game.
	mu.Lock()
	var foundComplete bool
	for _, ev := range events {
		if ev.Name == "analysis:complete" {
			if ac, ok := ev.Data.(AnalysisComplete); ok && ac.GameID == gameID {
				foundComplete = true
				if ac.Status != "error" {
					t.Errorf("analysis:complete status = %q, want %q", ac.Status, "error")
				}
			}
		}
	}
	mu.Unlock()
	if !foundComplete {
		t.Error("no analysis:complete event emitted for the failed game")
	}
}

// TestCancelAnalysisUpdatesDB verifies that after CancelAnalysis returns,
// no games remain in "pending" or "running" status.
func TestCancelAnalysisUpdatesDB(t *testing.T) {
	app := newTestApp(t)

	app.slot1.mu.Lock()
	app.slot1.path = "/nonexistent/engine-binary"
	app.slot1.mu.Unlock()

	app.emitFn = func(string, any) {}

	gameID, err := app.db.SaveGame(game.GameInput{
		White: "Alice", Black: "Bob", Result: "1-0",
		Date: "2024.01.01", Source: "test", SourceID: "cancel-test-1",
		PGN: "[White \"Alice\"]\n[Black \"Bob\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0",
	})
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	if err := app.AnalyseGame(gameID); err != nil {
		t.Fatalf("AnalyseGame: %v", err)
	}

	// Wait for workers to finish (they fail fast due to bad engine path).
	waitForAnalysisDone(app, 5*time.Second)

	// Call CancelAnalysis.
	if err := app.CancelAnalysis(); err != nil {
		t.Fatalf("CancelAnalysis: %v", err)
	}

	// The game must NOT have status "pending" or "running".
	rec, err := app.db.GetGameAnalysis(gameID)
	if err != nil {
		t.Fatalf("GetGameAnalysis: %v", err)
	}
	if rec == nil {
		t.Fatal("expected analysis record, got nil")
	}
	if rec.Status == "pending" || rec.Status == "running" {
		t.Errorf("game status = %q after cancel, want error/cancelled", rec.Status)
	}
}

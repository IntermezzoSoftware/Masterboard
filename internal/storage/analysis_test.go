package storage

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
)

func TestUpsertAndGetGameAnalysis(t *testing.T) {
	db := openTestDB(t)
	gameID, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}

	// Initially no analysis.
	rec, err := db.GetGameAnalysis(gameID)
	if err != nil {
		t.Fatalf("GetGameAnalysis: %v", err)
	}
	if rec != nil {
		t.Fatal("expected nil before upsert")
	}

	// Upsert with pending status.
	if err := db.UpsertGameAnalysis(gameID, 18, "pending"); err != nil {
		t.Fatalf("UpsertGameAnalysis: %v", err)
	}
	rec, err = db.GetGameAnalysis(gameID)
	if err != nil {
		t.Fatalf("GetGameAnalysis: %v", err)
	}
	if rec == nil {
		t.Fatal("expected non-nil")
	}
	if rec.Status != "pending" || rec.Depth != 18 {
		t.Errorf("got status=%q depth=%d, want pending/18", rec.Status, rec.Depth)
	}

	// Update to running.
	if err := db.UpdateAnalysisStatus(gameID, "running", ""); err != nil {
		t.Fatalf("UpdateAnalysisStatus: %v", err)
	}
	rec, _ = db.GetGameAnalysis(gameID)
	if rec.Status != "running" {
		t.Errorf("got status=%q, want running", rec.Status)
	}

	// Complete with evals.
	cp100 := 100
	cp50 := 50
	nag6 := 6
	evals := []analysis.MoveEval{
		{Ply: 1, BestCp: &cp100, PlayedCp: &cp50, BestPV: "e2e4 e7e5 g1f3", Accuracy: 95.5, Nag: &nag6},
		{Ply: 2, BestCp: &cp50, PlayedCp: &cp100, BestPV: "e7e5", Accuracy: 100},
	}
	if err := db.CompleteAnalysis(gameID, 87.5, 91.2, 22.3, 15.1, evals); err != nil {
		t.Fatalf("CompleteAnalysis: %v", err)
	}
	rec, _ = db.GetGameAnalysis(gameID)
	if rec.Status != "complete" {
		t.Errorf("got status=%q, want complete", rec.Status)
	}
	if rec.WhiteAccuracy == nil || *rec.WhiteAccuracy != 87.5 {
		t.Errorf("white accuracy: got %v, want 87.5", rec.WhiteAccuracy)
	}
	if rec.BlackAccuracy == nil || *rec.BlackAccuracy != 91.2 {
		t.Errorf("black accuracy: got %v, want 91.2", rec.BlackAccuracy)
	}
	if rec.WhiteACPL == nil || *rec.WhiteACPL != 22.3 {
		t.Errorf("white ACPL: got %v, want 22.3", rec.WhiteACPL)
	}
	if rec.BlackACPL == nil || *rec.BlackACPL != 15.1 {
		t.Errorf("black ACPL: got %v, want 15.1", rec.BlackACPL)
	}
	if rec.AnalysedAt == "" {
		t.Error("analysed_at should be set")
	}

	// Verify evals were persisted.
	if len(rec.Evals) != 2 {
		t.Fatalf("got %d evals, want 2", len(rec.Evals))
	}
	if rec.Evals[0].Ply != 1 || rec.Evals[0].BestPV != "e2e4 e7e5 g1f3" {
		t.Errorf("eval 0: %+v", rec.Evals[0])
	}
	if rec.Evals[0].BestCp == nil || *rec.Evals[0].BestCp != 100 {
		t.Errorf("eval 0 best_cp: got %v, want 100", rec.Evals[0].BestCp)
	}
	if rec.Evals[0].Nag == nil || *rec.Evals[0].Nag != 6 {
		t.Errorf("eval 0 nag: got %v, want 6", rec.Evals[0].Nag)
	}
	if rec.Evals[1].Nag != nil {
		t.Errorf("eval 1 nag: got %v, want nil", rec.Evals[1].Nag)
	}
}

func TestUpsertPreservesExistingResults(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())

	db.UpsertGameAnalysis(gameID, 18, "pending")
	cp10 := 10
	db.CompleteAnalysis(gameID, 80, 90, 30, 20, []analysis.MoveEval{
		{Ply: 1, BestCp: &cp10, BestPV: "e2e4", Accuracy: 50},
	})

	// Re-upsert (re-analysis) should update status/depth but preserve results
	// so they can be restored if the user cancels.
	db.UpsertGameAnalysis(gameID, 20, "running")
	rec, _ := db.GetGameAnalysis(gameID)
	if rec.Status != "running" || rec.Depth != 20 {
		t.Errorf("got status=%q depth=%d, want running/20", rec.Status, rec.Depth)
	}
	if rec.WhiteAccuracy == nil || *rec.WhiteAccuracy != 80 {
		t.Errorf("white accuracy should be preserved, got %v", rec.WhiteAccuracy)
	}
	if len(rec.Evals) != 1 {
		t.Errorf("evals should be preserved, got %d", len(rec.Evals))
	}
}

func TestCompleteAnalysisReplacesEvals(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	db.UpsertGameAnalysis(gameID, 18, "pending")

	cp10 := 10
	db.CompleteAnalysis(gameID, 80, 90, 30, 20, []analysis.MoveEval{
		{Ply: 1, BestCp: &cp10, BestPV: "e2e4", Accuracy: 50},
	})

	// Re-upsert and re-complete with different evals.
	db.UpsertGameAnalysis(gameID, 18, "running")
	cp20 := 20
	db.CompleteAnalysis(gameID, 85, 92, 25, 18, []analysis.MoveEval{
		{Ply: 1, BestCp: &cp20, BestPV: "e2e4", Accuracy: 100},
		{Ply: 2, BestCp: &cp10, BestPV: "e7e5", Accuracy: 100},
	})

	rec, _ := db.GetGameAnalysis(gameID)
	if len(rec.Evals) != 2 {
		t.Fatalf("got %d evals, want 2", len(rec.Evals))
	}
	if rec.Evals[0].BestCp == nil || *rec.Evals[0].BestCp != 20 {
		t.Errorf("eval 0 best_cp: got %v, want 20 (updated)", rec.Evals[0].BestCp)
	}
}

func TestDeleteGameAnalysis(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	db.UpsertGameAnalysis(gameID, 18, "running")
	cp10 := 10
	db.CompleteAnalysis(gameID, 80, 90, 30, 20, []analysis.MoveEval{
		{Ply: 1, BestCp: &cp10, BestPV: "e2e4", Accuracy: 100},
	})

	if err := db.DeleteGameAnalysis(gameID); err != nil {
		t.Fatalf("DeleteGameAnalysis: %v", err)
	}

	rec, _ := db.GetGameAnalysis(gameID)
	if rec != nil {
		t.Error("expected nil after delete")
	}
}

func TestResetStaleAnalyses(t *testing.T) {
	db := openTestDB(t)

	// Create 3 games with different analysis statuses.
	g1, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame g1: %v", err)
	}
	sg2 := sampleGame()
	sg2.SourceID = "test-stale-2"
	sg2.White = "Player-2"
	g2, err := db.SaveGame(sg2)
	if err != nil {
		t.Fatalf("SaveGame g2: %v", err)
	}
	sg3 := sampleGame()
	sg3.SourceID = "test-stale-3"
	sg3.White = "Player-3"
	g3, err := db.SaveGame(sg3)
	if err != nil {
		t.Fatalf("SaveGame g3: %v", err)
	}

	if err := db.UpsertGameAnalysis(g1, 18, "running"); err != nil {
		t.Fatalf("UpsertGameAnalysis g1: %v", err)
	}
	if err := db.UpsertGameAnalysis(g2, 18, "pending"); err != nil {
		t.Fatalf("UpsertGameAnalysis g2: %v", err)
	}
	if err := db.UpsertGameAnalysis(g3, 18, "pending"); err != nil {
		t.Fatalf("UpsertGameAnalysis g3: %v", err)
	}
	if err := db.CompleteAnalysis(g3, 87.5, 91.2, 22.3, 15.1, nil); err != nil {
		t.Fatalf("CompleteAnalysis g3: %v", err)
	}

	n, err := db.ResetStaleAnalyses()
	if err != nil {
		t.Fatalf("ResetStaleAnalyses: %v", err)
	}
	if n != 2 {
		t.Errorf("got %d affected rows, want 2", n)
	}

	// running -> error
	rec1, _ := db.GetGameAnalysis(g1)
	if rec1.Status != "error" {
		t.Errorf("g1 status: got %q, want error", rec1.Status)
	}
	if rec1.ErrorMsg != "interrupted by app restart" {
		t.Errorf("g1 error_msg: got %q", rec1.ErrorMsg)
	}

	// pending -> error
	rec2, _ := db.GetGameAnalysis(g2)
	if rec2.Status != "error" {
		t.Errorf("g2 status: got %q, want error", rec2.Status)
	}
	if rec2.ErrorMsg != "interrupted by app restart" {
		t.Errorf("g2 error_msg: got %q", rec2.ErrorMsg)
	}

	// complete -> unchanged
	rec3, _ := db.GetGameAnalysis(g3)
	if rec3.Status != "complete" {
		t.Errorf("g3 status: got %q, want complete", rec3.Status)
	}
	if rec3.WhiteAccuracy == nil || *rec3.WhiteAccuracy != 87.5 {
		t.Errorf("g3 white accuracy: got %v, want 87.5", rec3.WhiteAccuracy)
	}
	if rec3.BlackAccuracy == nil || *rec3.BlackAccuracy != 91.2 {
		t.Errorf("g3 black accuracy: got %v, want 91.2", rec3.BlackAccuracy)
	}
}

func TestResetStaleAnalysesNoRows(t *testing.T) {
	db := openTestDB(t)

	n, err := db.ResetStaleAnalyses()
	if err != nil {
		t.Fatalf("ResetStaleAnalyses: %v", err)
	}
	if n != 0 {
		t.Errorf("got %d affected rows, want 0", n)
	}
}

func TestCancelActiveAnalyses(t *testing.T) {
	db := openTestDB(t)

	g1, _ := db.SaveGame(sampleGame())
	sg2 := sampleGame()
	sg2.SourceID = "test-cancel-2"
	sg2.White = "Player-2"
	g2, _ := db.SaveGame(sg2)
	sg3 := sampleGame()
	sg3.SourceID = "test-cancel-3"
	sg3.White = "Player-3"
	g3, _ := db.SaveGame(sg3)
	// g4: a previously-complete game being re-analysed.
	sg4 := sampleGame()
	sg4.SourceID = "test-cancel-4"
	sg4.White = "Player-4"
	g4, _ := db.SaveGame(sg4)

	// g1 and g2: fresh analyses with no prior results.
	db.UpsertGameAnalysis(g1, 18, "running")
	db.UpsertGameAnalysis(g2, 18, "pending")
	// g3: pending then immediately completed — not active when we cancel.
	db.UpsertGameAnalysis(g3, 18, "pending")
	db.CompleteAnalysis(g3, 80, 90, 20, 15, nil)
	// g4: previously complete with real evals, now re-queued.
	db.UpsertGameAnalysis(g4, 18, "pending")
	db.CompleteAnalysis(g4, 85, 91, 14, 12, []analysis.MoveEval{{Ply: 1, Accuracy: 95.0}})
	db.UpsertGameAnalysis(g4, 18, "pending") // re-analysis: status → pending, evals preserved

	ids, err := db.CancelActiveAnalyses()
	if err != nil {
		t.Fatalf("CancelActiveAnalyses: %v", err)
	}
	// g1, g2 (fresh), g4 (re-analysis) are active; g3 is already complete.
	if len(ids) != 3 {
		t.Fatalf("got %d ids, want 3", len(ids))
	}

	// Fresh analyses (no prior results) should be deleted.
	rec1, _ := db.GetGameAnalysis(g1)
	if rec1 != nil {
		t.Errorf("g1: expected nil after cancel, got status=%q", rec1.Status)
	}
	rec2, _ := db.GetGameAnalysis(g2)
	if rec2 != nil {
		t.Errorf("g2: expected nil after cancel, got status=%q", rec2.Status)
	}
	// Already-complete analysis should be unaffected.
	rec3, _ := db.GetGameAnalysis(g3)
	if rec3.Status != "complete" {
		t.Errorf("g3: status=%q, want complete", rec3.Status)
	}
	// Re-analysis should be restored to complete with original results intact.
	rec4, _ := db.GetGameAnalysis(g4)
	if rec4 == nil {
		t.Fatal("g4: expected record after cancel, got nil")
	}
	if rec4.Status != "complete" {
		t.Errorf("g4: status=%q, want complete", rec4.Status)
	}
	if rec4.WhiteAccuracy == nil || *rec4.WhiteAccuracy != 85.0 {
		t.Errorf("g4: white accuracy=%v, want 85.0", rec4.WhiteAccuracy)
	}
}

func TestUpdateAnalysisStatusWithError(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	db.UpsertGameAnalysis(gameID, 18, "running")

	if err := db.UpdateAnalysisStatus(gameID, "error", "engine crashed"); err != nil {
		t.Fatalf("UpdateAnalysisStatus: %v", err)
	}

	rec, _ := db.GetGameAnalysis(gameID)
	if rec.Status != "error" {
		t.Errorf("got status=%q, want error", rec.Status)
	}
	if rec.ErrorMsg != "engine crashed" {
		t.Errorf("got error_msg=%q, want 'engine crashed'", rec.ErrorMsg)
	}
}

func TestMarkPgnAnnotatedStoresAppliedEvals(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	db.UpsertGameAnalysis(gameID, 18, "pending")

	cp100 := 100
	cp50 := 50
	nag4 := 4
	evals := []analysis.MoveEval{
		{Ply: 1, BestCp: &cp100, PlayedCp: &cp50, BestPV: "e2e4", Accuracy: 60.0, Nag: &nag4},
		{Ply: 2, BestCp: &cp50, PlayedCp: &cp100, BestPV: "e7e5", Accuracy: 100.0},
	}
	db.CompleteAnalysis(gameID, 70, 85, 40, 20, evals)

	if err := db.MarkPgnAnnotated(gameID, evals); err != nil {
		t.Fatalf("MarkPgnAnnotated: %v", err)
	}

	rec, _ := db.GetGameAnalysis(gameID)
	if !rec.PgnAnnotated {
		t.Error("expected PgnAnnotated = true")
	}
	if len(rec.AppliedEvals) != 2 {
		t.Fatalf("got %d applied evals, want 2", len(rec.AppliedEvals))
	}
	if rec.AppliedEvals[0].Ply != 1 {
		t.Errorf("applied eval 0 ply: got %d, want 1", rec.AppliedEvals[0].Ply)
	}
	if rec.AppliedEvals[0].Nag == nil || *rec.AppliedEvals[0].Nag != 4 {
		t.Errorf("applied eval 0 nag: got %v, want 4", rec.AppliedEvals[0].Nag)
	}
	if rec.AppliedEvals[1].Nag != nil {
		t.Errorf("applied eval 1 nag: got %v, want nil", rec.AppliedEvals[1].Nag)
	}
}

func TestUpsertDoesNotResetAppliedEvals(t *testing.T) {
	db := openTestDB(t)
	gameID, _ := db.SaveGame(sampleGame())
	db.UpsertGameAnalysis(gameID, 18, "pending")

	cp100 := 100
	nag6 := 6
	evals := []analysis.MoveEval{
		{Ply: 1, BestCp: &cp100, BestPV: "e2e4", Accuracy: 80.0, Nag: &nag6},
	}
	db.CompleteAnalysis(gameID, 80, 90, 30, 20, evals)
	db.MarkPgnAnnotated(gameID, evals)

	// Re-upsert simulates a new analysis run being started.
	db.UpsertGameAnalysis(gameID, 20, "running")

	rec, _ := db.GetGameAnalysis(gameID)
	// evals, pgn_annotated, and applied_evals are all preserved through re-upsert.
	if len(rec.Evals) != 1 {
		t.Errorf("evals should be preserved after re-upsert, got %d", len(rec.Evals))
	}
	if !rec.PgnAnnotated {
		t.Error("pgn_annotated should be preserved after re-upsert")
	}
	if len(rec.AppliedEvals) != 1 {
		t.Fatalf("applied evals should survive re-upsert, got %d", len(rec.AppliedEvals))
	}
	if rec.AppliedEvals[0].Nag == nil || *rec.AppliedEvals[0].Nag != 6 {
		t.Errorf("applied eval nag: got %v, want 6", rec.AppliedEvals[0].Nag)
	}
}

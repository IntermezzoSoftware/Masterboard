package engine

import (
	"testing"
)

func TestParseInfo_NormalWithPV(t *testing.T) {
	info := parseInfo("info depth 20 seldepth 25 multipv 1 score cp 45 nodes 5000000 nps 2500000 time 2000 pv e2e4 e7e5 g1f3")
	if info == nil {
		t.Fatal("expected non-nil InfoLine")
	}
	if info.Depth != 20 {
		t.Errorf("depth: got %d, want 20", info.Depth)
	}
	if info.ScoreCp != 45 {
		t.Errorf("score cp: got %d, want 45", info.ScoreCp)
	}
	if len(info.PV) != 3 {
		t.Fatalf("PV length: got %d, want 3", len(info.PV))
	}
	if info.PV[0] != "e2e4" || info.PV[1] != "e7e5" || info.PV[2] != "g1f3" {
		t.Errorf("PV: got %v", info.PV)
	}
}

func TestParseInfo_NoPVField(t *testing.T) {
	info := parseInfo("info depth 18 seldepth 25 score cp 50 nodes 5000000 nps 2500000 time 2000")
	if info == nil {
		t.Fatal("expected non-nil InfoLine")
	}
	if len(info.PV) != 0 {
		t.Errorf("PV should be empty, got %v", info.PV)
	}
	if info.MultiPV != 1 {
		t.Errorf("MultiPV should default to 1, got %d", info.MultiPV)
	}
}

func TestParseInfo_Lowerbound(t *testing.T) {
	info := parseInfo("info depth 18 score cp 50 lowerbound nodes 5000000")
	if info == nil {
		t.Fatal("expected non-nil InfoLine")
	}
	if info.ScoreCp != 50 {
		t.Errorf("score cp: got %d, want 50", info.ScoreCp)
	}
	if len(info.PV) != 0 {
		t.Errorf("PV should be empty for lowerbound line, got %v", info.PV)
	}
}

func TestParseInfo_StringLine(t *testing.T) {
	info := parseInfo("info string d2d4 (204) N: 1 (+ 0) (P: 14.57%)")
	if info != nil {
		t.Error("expected nil for info string line")
	}
}

func TestParseInfo_NotInfoLine(t *testing.T) {
	if parseInfo("readyok") != nil {
		t.Error("expected nil for readyok")
	}
	if parseInfo("uciok") != nil {
		t.Error("expected nil for uciok")
	}
	if parseInfo("") != nil {
		t.Error("expected nil for empty string")
	}
}

func TestParseInfo_MateScore(t *testing.T) {
	info := parseInfo("info depth 15 score mate 3 pv e2e4")
	if info == nil {
		t.Fatal("expected non-nil InfoLine")
	}
	if !info.IsMate {
		t.Error("expected IsMate=true")
	}
	if info.ScoreMate != 3 {
		t.Errorf("ScoreMate: got %d, want 3", info.ScoreMate)
	}
}

func TestParseBestMove(t *testing.T) {
	bm := parseBestMove("bestmove e2e4 ponder e7e5")
	if bm == nil {
		t.Fatal("expected non-nil BestMoveMsg")
	}
	if bm.Move != "e2e4" {
		t.Errorf("Move: got %q, want e2e4", bm.Move)
	}
	if bm.Ponder != "e7e5" {
		t.Errorf("Ponder: got %q, want e7e5", bm.Ponder)
	}
}

func TestParseBestMove_NoPonder(t *testing.T) {
	bm := parseBestMove("bestmove e2e4")
	if bm == nil {
		t.Fatal("expected non-nil BestMoveMsg")
	}
	if bm.Move != "e2e4" {
		t.Errorf("Move: got %q, want e2e4", bm.Move)
	}
	if bm.Ponder != "" {
		t.Errorf("Ponder: got %q, want empty", bm.Ponder)
	}
}

func TestParseBestMove_None(t *testing.T) {
	bm := parseBestMove("bestmove (none)")
	if bm == nil {
		t.Fatal("expected non-nil BestMoveMsg")
	}
	if bm.Move != "(none)" {
		t.Errorf("Move: got %q, want (none)", bm.Move)
	}
}

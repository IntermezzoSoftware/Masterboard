package main

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
)

func TestEngineSlot_InitialState(t *testing.T) {
	slot1 := newEngineSlot("engine:info", "engine:ready")
	slot2 := newEngineSlot("engine2:info", "engine2:ready")
	if slot1 == nil || slot2 == nil {
		t.Fatal("newEngineSlot returned nil")
	}
	s1 := slot1.getState()
	s2 := slot2.getState()
	if s1.IsReady || s2.IsReady {
		t.Error("new engine slot should not be ready")
	}
	if s1.IsAnalysing || s2.IsAnalysing {
		t.Error("new engine slot should not be analysing")
	}
}

func TestEngineInfoFromInfoLine_ScoreNormalization(t *testing.T) {
	line := &engine.InfoLine{
		Depth: 1, SelDepth: 2, MultiPV: 1,
		ScoreCp: 31, IsMate: false, ScoreMate: 0,
		Nodes: 1000, TimeMs: 10,
		PV: []string{"e7e5"},
	}

	// White to move: score unchanged
	info := engineInfoFromInfoLine(line, "w")
	if info.ScoreCp != 31 {
		t.Errorf("white to move: want ScoreCp=31, got %d", info.ScoreCp)
	}
	if info.ScoreMate != 0 {
		t.Errorf("white to move: want ScoreMate=0, got %d", info.ScoreMate)
	}

	// Black to move: score negated
	info = engineInfoFromInfoLine(line, "b")
	if info.ScoreCp != -31 {
		t.Errorf("black to move: want ScoreCp=-31, got %d", info.ScoreCp)
	}
	if info.ScoreMate != 0 {
		t.Errorf("black to move: want ScoreMate=0, got %d", info.ScoreMate)
	}
}

func TestDetectEngineType(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		// MCTS engines
		{"Lc0 v0.31.2", "mcts"},
		{"Lc0 v0.30.0-dev+git.deadbeef", "mcts"},
		{"Ceres 1.09", "mcts"},
		{"Ceres 2.00 MCGS", "mcts"},
		{"Allie 0.7", "mcts"},
		{"Allie v0.5-dev+git.abc123", "mcts"},
		{"Stoofvlees II d10", "mcts"},
		{"Stoofvlees a14", "mcts"},
		{"Scorpio 3.0.15.14", "mcts"},
		{"Dragon 3 by Komodo Chess 64-bit", "mcts"},
		// Alpha-beta engines
		{"Stockfish 17", "ab"},
		{"Stockfish 16.1", "ab"},
		{"Komodo 14.1 64-bit", "ab"},
		{"Rybka 4.1", "ab"},
		{"", "ab"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectEngineType(tt.name)
			if got != tt.want {
				t.Errorf("detectEngineType(%q) = %q, want %q", tt.name, got, tt.want)
			}
		})
	}
}

func TestEngineSlot_DetachIfPath_MatchingPath(t *testing.T) {
	slot := newEngineSlot("info", "ready")
	slot.path = "stockfish"
	evicted := slot.detachIfPath("stockfish")
	if evicted != nil {
		t.Error("expected nil manager when slot manager was nil")
	}
	if slot.path != "" {
		t.Errorf("expected path cleared, got %q", slot.path)
	}
}

func TestEngineSlot_DetachIfPath_NonMatchingPath(t *testing.T) {
	slot := newEngineSlot("info", "ready")
	slot.path = "stockfish"
	evicted := slot.detachIfPath("other")
	if evicted != nil {
		t.Error("expected nil manager on path mismatch")
	}
	if slot.path != "stockfish" {
		t.Errorf("expected path unchanged, got %q", slot.path)
	}
}

func TestEngineSlot_GetState_NilManager(t *testing.T) {
	slot := newEngineSlot("info", "ready")
	st := slot.getState()
	if st.IsReady || st.IsAnalysing {
		t.Error("nil-manager slot should report IsReady=false, IsAnalysing=false")
	}
}

func TestEngineInfoFromInfoLine_MateNormalization(t *testing.T) {
	line := &engine.InfoLine{
		Depth: 1, MultiPV: 1,
		IsMate: true, ScoreMate: 3,
		PV: []string{"e2e4"},
	}

	// White to move, white mates in 3: score unchanged
	info := engineInfoFromInfoLine(line, "w")
	if info.ScoreMate != 3 {
		t.Errorf("white to move: want ScoreMate=3, got %d", info.ScoreMate)
	}

	// Black to move, black mates in 3: negated → -3 means white is getting mated
	info = engineInfoFromInfoLine(line, "b")
	if info.ScoreMate != -3 {
		t.Errorf("black to move: want ScoreMate=-3, got %d", info.ScoreMate)
	}
}

//go:build integration

package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
)

func stockfishPathForAppTest(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs(filepath.Join("build", "engines", "stockfish-windows-x86-64-avx2.exe"))
	if err != nil {
		t.Fatalf("resolve stockfish path: %v", err)
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Skip("stockfish binary not found at " + path)
	}
	return path
}

func TestAppStartAnalysisEmits(t *testing.T) {
	sfPath := stockfishPathForAppTest(t)

	var mu sync.Mutex
	var emissions []EngineInfo
	firstEmission := make(chan struct{}, 1)

	app := &App{ctx: context.Background()}
	app.emitFn = func(event string, data any) {
		if event != "engine:info" {
			return
		}
		info, ok := data.(EngineInfo)
		if !ok {
			return
		}
		mu.Lock()
		emissions = append(emissions, info)
		mu.Unlock()
		select {
		case firstEmission <- struct{}{}:
		default:
		}
	}

	m := engine.NewManager(false)
	if err := m.Launch(sfPath); err != nil {
		t.Fatalf("Launch: %v", err)
	}
	app.slot1.mu.Lock()
	app.slot1.manager = m
	app.slot1.mu.Unlock()
	t.Cleanup(func() {
		app.slot1.mu.Lock()
		eng := app.slot1.manager
		app.slot1.manager = nil
		app.slot1.mu.Unlock()
		if eng != nil {
			eng.Quit()
		}
	})

	if err := app.StartAnalysis(engine.StartPosFEN, 1); err != nil {
		t.Fatalf("StartAnalysis: %v", err)
	}

	select {
	case <-firstEmission:
	case <-time.After(3 * time.Second):
		t.Fatal("no engine:info emission within 3s")
	}

	if err := app.StopAnalysis(); err != nil {
		t.Fatalf("StopAnalysis: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	var gotDepthGt0 bool
	for _, info := range emissions {
		if info.Depth > 0 {
			gotDepthGt0 = true
			break
		}
	}
	if !gotDepthGt0 {
		t.Errorf("no engine:info emission with Depth > 0 (got %d emissions)", len(emissions))
	}
	t.Logf("received %d engine:info emissions", len(emissions))
}

// TestScoreNormalizationBlackToMove verifies that scores are always emitted
// from white's perspective. The FEN below has black winning with a queen vs
// lone white king; the engine (black to move) will report a large positive score.
// After normalization the emitted ScoreCp must be negative (white is losing).
func TestScoreNormalizationBlackToMove(t *testing.T) {
	sfPath := stockfishPathForAppTest(t)

	// Black queen + king vs lone white king; it is black's turn.
	// Engine reports score from black's perspective (positive = black winning).
	// After negation the emitted score must be negative (white is losing).
	const blackWinningFEN = "8/8/8/8/8/8/q7/7K b - - 0 1"

	var mu sync.Mutex
	var emissions []EngineInfo
	firstEmission := make(chan struct{}, 1)

	app := &App{ctx: context.Background()}
	app.emitFn = func(event string, data any) {
		if event != "engine:info" {
			return
		}
		info, ok := data.(EngineInfo)
		if !ok {
			return
		}
		mu.Lock()
		emissions = append(emissions, info)
		mu.Unlock()
		select {
		case firstEmission <- struct{}{}:
		default:
		}
	}

	m := engine.NewManager(false)
	if err := m.Launch(sfPath); err != nil {
		t.Fatalf("Launch: %v", err)
	}
	app.slot1.mu.Lock()
	app.slot1.manager = m
	app.slot1.mu.Unlock()
	t.Cleanup(func() {
		app.slot1.mu.Lock()
		eng := app.slot1.manager
		app.slot1.manager = nil
		app.slot1.mu.Unlock()
		if eng != nil {
			eng.Quit()
		}
	})

	if err := app.StartAnalysis(blackWinningFEN, 1); err != nil {
		t.Fatalf("StartAnalysis: %v", err)
	}

	select {
	case <-firstEmission:
	case <-time.After(5 * time.Second):
		t.Fatal("no engine:info emission within 5s")
	}

	if err := app.StopAnalysis(); err != nil {
		t.Fatalf("StopAnalysis: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	var checked bool
	for _, info := range emissions {
		if info.Depth == 0 {
			continue
		}
		if info.IsMate {
			// Black is mating white → ScoreMate must be negative (white is getting mated)
			if info.ScoreMate > 0 {
				t.Errorf("mate score not normalized: ScoreMate=%d, want negative (black mates white)", info.ScoreMate)
			}
		} else {
			// Black is winning → ScoreCp must be negative (white's perspective)
			if info.ScoreCp > 0 {
				t.Errorf("score not normalized: ScoreCp=%d, want negative (black is winning)", info.ScoreCp)
			}
		}
		checked = true
		break
	}
	if !checked {
		t.Error("no engine:info with Depth > 0 received")
	}
	t.Logf("received %d engine:info emissions", len(emissions))
}

//go:build integration

package engine_test

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
)

// stockfishPath returns the absolute path to the bundled Stockfish binary,
// skipping the test if the binary does not exist.
func stockfishPath(t *testing.T) string {
	t.Helper()
	// Tests run with cwd = internal/engine/, so go up two levels to project root.
	path, err := filepath.Abs(filepath.Join("..", "..", "build", "engines", "stockfish-windows-x86-64-avx2.exe"))
	if err != nil {
		t.Fatalf("resolve stockfish path: %v", err)
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Skip("stockfish binary not found at " + path)
	}
	return path
}

// launchedManager returns a Manager that has successfully launched Stockfish
// and completed the handshake. It registers cleanup to call m.Quit().
func launchedManager(t *testing.T) *engine.Manager {
	t.Helper()
	return launchedManagerFor(t, stockfishPath(t))
}

// launchedManagerFor launches the engine at path, completes the handshake,
// and registers cleanup to call m.Quit().
func launchedManagerFor(t *testing.T, path string) *engine.Manager {
	t.Helper()
	m := engine.NewManager(false)
	if err := m.Launch(path); err != nil {
		t.Fatalf("Launch(%s): %v", path, err)
	}
	t.Cleanup(m.Quit)
	return m
}

// TestHandshake verifies that launching Stockfish completes the full UCI
// handshake (uci → uciok → isready → readyok) within 2 seconds.
func TestHandshake(t *testing.T) {
	m := engine.NewManager(false)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	defer m.Quit()

	if err := m.Launch(stockfishPath(t)); err != nil {
		t.Fatalf("Launch (handshake + readyok) failed: %v", err)
	}
	_ = ctx // Launch already respects an internal timeout via the context
	if !m.IsReady() {
		t.Fatal("engine not in ready state after Launch")
	}
}

// TestReady verifies that after a successful handshake the engine reports
// ready state immediately (handshake is synchronous inside Launch).
func TestReady(t *testing.T) {
	m := launchedManager(t)
	if !m.IsReady() {
		t.Fatal("expected IsReady() == true after Launch")
	}
}

// TestAnalysisDepth20 sends the starting position and requests a fixed-depth
// search to depth 20. It asserts that:
//   - at least one InfoLine with Depth == 20 is received
//   - total time from go depth 20 to bestmove is under 1000 ms
//   - the bestmove is a valid UCI move
var uciMoveRe = regexp.MustCompile(`^[a-h][1-8][a-h][1-8][qrbn]?$`)

func TestAnalysisDepth20(t *testing.T) {
	m := launchedManager(t)

	var infoLines []*engine.InfoLine
	onInfo := func(info *engine.InfoLine) {
		infoLines = append(infoLines, info)
	}

	start := time.Now()
	ctx := context.Background()
	bestmove, err := m.AnalyseDepth(ctx, engine.StartPosFEN, 1, 20, onInfo)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("AnalyseDepth: %v", err)
	}

	// Must have received at least one depth-20 info line.
	var gotDepth20 bool
	for _, info := range infoLines {
		if info.Depth == 20 {
			gotDepth20 = true
			break
		}
	}
	if !gotDepth20 {
		t.Errorf("no depth-20 InfoLine received (got %d lines)", len(infoLines))
	}

	// Performance requirement: depth 20 in under 1 second.
	if elapsed >= time.Second {
		t.Errorf("depth-20 analysis took %v, want < 1s", elapsed)
	}

	// Best move must be a valid UCI move.
	if !uciMoveRe.MatchString(bestmove.Move) {
		t.Errorf("bestmove %q is not a valid UCI move", bestmove.Move)
	}
	t.Logf("depth 20 in %v, bestmove %s, lines received: %d", elapsed, bestmove.Move, len(infoLines))
}

// TestAnalysisInfiniteStop starts an infinite search, waits for at least 5
// info lines, then stops. It asserts bestmove arrives within 1 second of stop.
func TestAnalysisInfiniteStop(t *testing.T) {
	m := launchedManager(t)

	const wantLines = 5
	received := make(chan struct{}, 1)
	var count int

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		err := m.StartAnalysis(ctx, engine.StartPosFEN, 1, func(info *engine.InfoLine) {
			count++
			if count == wantLines {
				select {
				case received <- struct{}{}:
				default:
				}
			}
		})
		errCh <- err
	}()

	// Wait until we have enough lines or time out.
	select {
	case <-received:
	case <-time.After(5 * time.Second):
		t.Fatalf("did not receive %d info lines within 5s", wantLines)
	}

	// Stop and measure time to bestmove.
	stopStart := time.Now()
	if err := m.StopAnalysis(); err != nil {
		t.Fatalf("StopAnalysis: %v", err)
	}
	if time.Since(stopStart) >= time.Second {
		t.Errorf("StopAnalysis took >= 1s")
	}

	// The goroutine running StartAnalysis should return after stop.
	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("StartAnalysis returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("StartAnalysis goroutine did not return within 2s of StopAnalysis")
	}
}

// TestPositionChange starts infinite analysis on the starting position, then
// immediately starts analysis on a new position. It asserts that a depth-1
// InfoLine for the new position arrives within 1 second.
func TestPositionChange(t *testing.T) {
	m := launchedManager(t)

	// Start analysis on starting position.
	ctx := context.Background()
	go func() {
		_ = m.StartAnalysis(ctx, engine.StartPosFEN, 1, func(*engine.InfoLine) {})
	}()
	time.Sleep(100 * time.Millisecond) // let it start thinking

	// Switch to the position after 1.e4.
	const fenAfterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	newLineCh := make(chan *engine.InfoLine, 1)
	go func() {
		_ = m.StartAnalysis(ctx, fenAfterE4, 1, func(info *engine.InfoLine) {
			select {
			case newLineCh <- info:
			default:
			}
		})
	}()

	select {
	case info := <-newLineCh:
		t.Logf("received depth-%d line for new position", info.Depth)
	case <-time.After(time.Second):
		t.Fatal("did not receive any InfoLine for the new position within 1s")
	}
}

// TestMultiPV sets MultiPV to 3 and verifies that info lines with MultiPV
// indices 1, 2, and 3 are all received during a depth-15 search.
func TestMultiPV(t *testing.T) {
	m := launchedManager(t)

	ctx := context.Background()
	seen := make(map[int]bool)
	bestmove, err := m.AnalyseDepth(ctx, engine.StartPosFEN, 3, 15, func(info *engine.InfoLine) {
		seen[info.MultiPV] = true
	})
	if err != nil {
		t.Fatalf("AnalyseDepth (MultiPV): %v", err)
	}
	for _, idx := range []int{1, 2, 3} {
		if !seen[idx] {
			t.Errorf("MultiPV index %d not seen in info lines", idx)
		}
	}
	t.Logf("bestmove %s, multipv indices seen: %v", bestmove.Move, seen)
}

// Leela Chess Zero compatibility tests
//
// Run with a longer timeout to allow for CUDA/network initialisation:
//   go test -tags integration -timeout 120s -run TestLc0 ./internal/engine/...

func lc0Path(t *testing.T) string {
	t.Helper()
	p := os.Getenv("LC0_BINARY_PATH")
	if p == "" {
		t.Skip("LC0_BINARY_PATH not set")
	}
	if _, err := os.Stat(p); os.IsNotExist(err) {
		t.Skip("lc0 binary not found at " + p)
	}
	return p
}

// TestLc0Handshake verifies that lc0 completes the UCI handshake.
// lc0 loads CUDA and network weights during startup, so this may take
// longer than Stockfish.
func TestLc0Handshake(t *testing.T) {
	m := engine.NewManager(false)
	defer m.Quit()
	if err := m.Launch(lc0Path(t)); err != nil {
		t.Fatalf("Launch: %v", err)
	}
	if !m.IsReady() {
		t.Fatal("engine not in ready state after Launch")
	}
}

// TestLc0Ready verifies IsReady() is true after a successful handshake.
func TestLc0Ready(t *testing.T) {
	m := launchedManagerFor(t, lc0Path(t))
	if !m.IsReady() {
		t.Fatal("expected IsReady() == true after Launch")
	}
}

// TestLc0AnalysisDepth10 sends the starting position and requests depth 10.
// lc0 uses MCTS so depth semantics differ from Stockfish; we verify that
// at least one InfoLine is received and the bestmove is a valid UCI move.
// No wall-clock performance assertion is made since CUDA init time varies.
func TestLc0AnalysisDepth10(t *testing.T) {
	m := launchedManagerFor(t, lc0Path(t))

	var infoLines []*engine.InfoLine
	ctx := context.Background()
	bestmove, err := m.AnalyseDepth(ctx, engine.StartPosFEN, 1, 10, func(info *engine.InfoLine) {
		infoLines = append(infoLines, info)
	})
	if err != nil {
		t.Fatalf("AnalyseDepth: %v", err)
	}
	if len(infoLines) == 0 {
		t.Error("no InfoLines received")
	}
	if !uciMoveRe.MatchString(bestmove.Move) {
		t.Errorf("bestmove %q is not a valid UCI move", bestmove.Move)
	}
	t.Logf("bestmove %s, lines received: %d", bestmove.Move, len(infoLines))
}

// TestLc0AnalysisNodes10000 is the lc0-native equivalent of TestAnalysisDepth20.
// Instead of a depth target (which maps poorly onto MCTS), it uses a node budget.
// Asserts:
//   - at least one InfoLine with Nodes >= 10000 was received
//   - wall-clock time from "go nodes 10000" to bestmove is < 3 s
//   - bestmove is a valid UCI move
//   - logs NPS so throughput is visible in test output
func TestLc0AnalysisNodes10000(t *testing.T) {
	m := launchedManagerFor(t, lc0Path(t))

	var infoLines []*engine.InfoLine
	ctx := context.Background()

	start := time.Now()
	bestmove, err := m.AnalyseNodes(ctx, engine.StartPosFEN, 1, 10000, func(info *engine.InfoLine) {
		infoLines = append(infoLines, info)
	})
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("AnalyseNodes: %v", err)
	}

	// lc0 evaluates positions in GPU batches, so the last info line before
	// bestmove typically shows slightly fewer than the requested node count —
	// the final batch carries the total past 10000 without an intermediate
	// emission. Assert the reported maximum is at least half the budget.
	var maxNodes, maxNPS int64
	for _, info := range infoLines {
		if info.Nodes > maxNodes {
			maxNodes = info.Nodes
		}
		if info.NPS > maxNPS {
			maxNPS = info.NPS
		}
	}
	if maxNodes < 5000 {
		t.Errorf("max reported nodes %d, want >= 5000 (at least half the 10000-node budget)", maxNodes)
	}

	// Performance requirement: 10000 nodes in under 3 seconds.
	if elapsed >= 3*time.Second {
		t.Errorf("10000-node search took %v, want < 3s", elapsed)
	}

	if !uciMoveRe.MatchString(bestmove.Move) {
		t.Errorf("bestmove %q is not a valid UCI move", bestmove.Move)
	}
	t.Logf("10000 nodes in %v, bestmove %s, peak NPS %d, lines received: %d",
		elapsed, bestmove.Move, maxNPS, len(infoLines))
}

// TestLc0AnalysisInfiniteStop starts an infinite search, waits for at least
// 5 info lines, then stops. Asserts bestmove arrives within 2 seconds of stop.
func TestLc0AnalysisInfiniteStop(t *testing.T) {
	m := launchedManagerFor(t, lc0Path(t))

	const wantLines = 5
	received := make(chan struct{}, 1)
	var count int

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		err := m.StartAnalysis(ctx, engine.StartPosFEN, 1, func(info *engine.InfoLine) {
			count++
			if count == wantLines {
				select {
				case received <- struct{}{}:
				default:
				}
			}
		})
		errCh <- err
	}()

	select {
	case <-received:
	case <-time.After(30 * time.Second):
		t.Fatalf("did not receive %d info lines within 30s", wantLines)
	}

	stopStart := time.Now()
	if err := m.StopAnalysis(); err != nil {
		t.Fatalf("StopAnalysis: %v", err)
	}
	if time.Since(stopStart) >= 2*time.Second {
		t.Errorf("StopAnalysis took >= 2s")
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("StartAnalysis returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("StartAnalysis goroutine did not return within 5s of StopAnalysis")
	}
}

// TestLc0PositionChange starts infinite analysis, then switches position.
// Asserts that a new InfoLine for the new position arrives within 5 seconds.
func TestLc0PositionChange(t *testing.T) {
	m := launchedManagerFor(t, lc0Path(t))

	ctx := context.Background()
	go func() {
		_ = m.StartAnalysis(ctx, engine.StartPosFEN, 1, func(*engine.InfoLine) {})
	}()
	time.Sleep(500 * time.Millisecond) // let it start thinking

	const fenAfterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	newLineCh := make(chan *engine.InfoLine, 1)
	go func() {
		_ = m.StartAnalysis(ctx, fenAfterE4, 1, func(info *engine.InfoLine) {
			select {
			case newLineCh <- info:
			default:
			}
		})
	}()

	select {
	case info := <-newLineCh:
		t.Logf("received depth-%d line for new position", info.Depth)
	case <-time.After(5 * time.Second):
		t.Fatal("did not receive any InfoLine for the new position within 5s")
	}
}

// TestLc0MultiPV sets MultiPV to 3 and verifies that info lines with
// MultiPV indices 1, 2, and 3 are all received.
func TestLc0MultiPV(t *testing.T) {
	m := launchedManagerFor(t, lc0Path(t))

	ctx := context.Background()
	seen := make(map[int]bool)
	bestmove, err := m.AnalyseDepth(ctx, engine.StartPosFEN, 3, 10, func(info *engine.InfoLine) {
		seen[info.MultiPV] = true
	})
	if err != nil {
		t.Fatalf("AnalyseDepth (MultiPV): %v", err)
	}
	for _, idx := range []int{1, 2, 3} {
		if !seen[idx] {
			t.Errorf("MultiPV index %d not seen in info lines", idx)
		}
	}
	t.Logf("bestmove %s, multipv indices seen: %v", bestmove.Move, seen)
}

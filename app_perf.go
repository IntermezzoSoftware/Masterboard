//go:build perf

// This file contains all Go-side instrumentation for the automated
// performance test harness. It is compiled only when `-tags perf` is passed
// to `go build` / `wails build`. Release builds use the no-op stubs in
// app_perf_stub.go and contain zero perf-instrumentation surface.
//
// All runtime hooks are registered on the Wails event bus rather than as
// auto-bound IPC methods, so even if Wails' binding generator does not
// respect build tags (see wailsapp/wails#1610), no perf-only methods can
// leak into the release TypeScript bindings.

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// perfEnvDataDir overrides the default data directory when set. The test
// harness launches the instrumented binary with this variable pointing at an
// isolated temp directory so perf runs never touch the user's real SQLite DB.
const perfEnvDataDir = "MASTERBOARD_DATA_DIR"

// resolveDataDir returns the Masterboard data directory. If the
// MASTERBOARD_DATA_DIR env var is set, it wins; otherwise we fall back to the
// platform's per-user config directory under "Masterboard", matching the
// release-build behaviour.
func resolveDataDir() string {
	if override := os.Getenv(perfEnvDataDir); override != "" {
		return override
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Printf("failed to get config dir: %v", err)
		configDir = "."
	}
	return filepath.Join(configDir, "Masterboard")
}

// registerPerfHandlers installs runtime event-bus handlers used by the
// performance test harness. Handler names are prefixed with "__perf:" to
// mark them as instrumentation, not product surface.
//
// All handlers ack their completion by emitting "__perf:ack" with the
// originating command name so the test harness can await each operation.
// Errors are reported via "__perf:error".
//
// Unit tests that exercise startup() pass a plain context.Background(),
// which carries no Wails event bus — wailsRuntime.EventsOn calls
// log.Fatalf (os.Exit) in that case. We skip registration cleanly when no
// event bus is attached; production contexts, set up by the Wails lifecycle
// hook, register handlers normally.
func (a *App) registerPerfHandlers(ctx context.Context) {
	if ctx == nil || ctx.Value("events") == nil {
		log.Printf("[perf] registerPerfHandlers skipped: ctx has no Wails event bus (test context)")
		return
	}
	log.Printf("[perf] registering instrumentation handlers (build has -tags perf)")

	ack := func(cmd string, payload any) {
		wailsRuntime.EventsEmit(ctx, "__perf:ack", map[string]any{
			"cmd":     cmd,
			"payload": payload,
		})
	}
	fail := func(cmd string, err error) {
		log.Printf("[perf] %s failed: %v", cmd, err)
		wailsRuntime.EventsEmit(ctx, "__perf:error", map[string]any{
			"cmd":   cmd,
			"error": err.Error(),
		})
	}

	// Simple handshake — the harness calls this right after CDP connect to
	// verify the binary was actually built with -tags perf.
	wailsRuntime.EventsOn(ctx, "__perf:ping", func(_ ...any) {
		ack("ping", map[string]any{"ready": true})
	})

	// Announce instrumentation availability on startup so harnesses that
	// connect after startup fires can still detect the perf build.
	wailsRuntime.EventsEmit(ctx, "__perf:ready", map[string]any{"build": "perf"})

	// __perf:seed-games inserts N synthetic games directly into the active
	// database, bypassing the real PGN import pipeline. The test harness uses
	// this to set up large game lists quickly for scroll / list-render
	// scenarios without paying real-import cost on every run.
	wailsRuntime.EventsOn(ctx, "__perf:seed-games", func(args ...any) {
		if a.db == nil {
			fail("seed-games", fmt.Errorf("db not open"))
			return
		}
		count := 100
		if len(args) > 0 {
			if n, ok := args[0].(float64); ok {
				count = int(n)
			}
		}
		inserted := 0
		for i := 0; i < count; i++ {
			_, err := a.db.SaveGame(game.GameInput{
				White:  fmt.Sprintf("PerfWhite%d", i),
				Black:  fmt.Sprintf("PerfBlack%d", i),
				Result: "1-0",
				Date:   "2026.01.01",
				Event:  "Perf Harness",
				Site:   "Masterboard",
				Round:  "1",
				ECO:    "C00",
				Source: "perf",
				PGN:    fmt.Sprintf("[White \"PerfWhite%d\"]\n[Black \"PerfBlack%d\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n", i, i),
			})
			if err != nil {
				fail("seed-games", fmt.Errorf("insert %d: %w", i, err))
				return
			}
			inserted++
		}
		ack("seed-games", map[string]any{"inserted": inserted})
	})

	// __perf:reset truncates the games table so the harness can restore a
	// known-empty state between scenarios without having to respawn the
	// binary. Settings and schema are left intact.
	wailsRuntime.EventsOn(ctx, "__perf:reset", func(_ ...any) {
		if a.db == nil {
			fail("reset", fmt.Errorf("db not open"))
			return
		}
		if err := a.db.PerfTruncateGames(); err != nil {
			fail("reset", err)
			return
		}
		ack("reset", nil)
	})
}

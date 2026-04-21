//go:build !perf

package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
)

// resolveDataDir returns the Masterboard data directory.
// Release builds always use os.UserConfigDir()/Masterboard.
func resolveDataDir() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Printf("failed to get config dir: %v", err)
		configDir = "."
	}
	return filepath.Join(configDir, "Masterboard")
}

// registerPerfHandlers is a no-op in release builds. The perf-tagged
// implementation in app_perf.go registers event-bus handlers used by the
// automated performance test harness. The compiler inlines this away, leaving
// zero perf-instrumentation surface in the release binary.
func (a *App) registerPerfHandlers(ctx context.Context) {
	_ = ctx
}

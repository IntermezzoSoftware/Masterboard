package engine

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// isEngineExecutable reports whether the file at path looks like a UCI engine
// binary. On Windows, only .exe files qualify. On other platforms, the
// executable bit must be set — extension alone is not sufficient because
// engine zips (e.g. lc0) contain extension-less text files (README, LICENSE).
func isEngineExecutable(path, name string) bool {
	if strings.HasPrefix(name, ".") {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Ext(name), ".exe")
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Mode().IsRegular() && info.Mode()&0111 != 0
}

func findBundledEngines(baseDir string) []string {
	enginesDir := filepath.Join(baseDir, "engines")
	entries, err := os.ReadDir(enginesDir)
	if err != nil {
		return nil
	}

	var paths []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if e.IsDir() {
			// One level deep — downloaded engine subdirectory.
			subEntries, err := os.ReadDir(filepath.Join(enginesDir, e.Name()))
			if err != nil {
				continue
			}
			for _, sub := range subEntries {
				if sub.IsDir() || strings.HasPrefix(sub.Name(), ".") {
					continue
				}
				p := filepath.Join(enginesDir, e.Name(), sub.Name())
				if isEngineExecutable(p, sub.Name()) {
					paths = append(paths, p)
				}
			}
		} else {
			p := filepath.Join(enginesDir, e.Name())
			if isEngineExecutable(p, e.Name()) {
				paths = append(paths, p)
			}
		}
	}
	return paths
}

// DefaultEngines returns bundled engines first, then any "stockfish" found on
// the system PATH.
func DefaultEngines(baseDir string) []string {
	paths := findBundledEngines(baseDir)
	if lp, err := exec.LookPath("stockfish"); err == nil {
		paths = append(paths, lp)
	}
	return paths
}

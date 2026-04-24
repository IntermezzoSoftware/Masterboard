package engine

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// isEngineExecutable reports whether the file at path looks like a UCI engine
// binary. On Windows, only .exe files qualify. On Mac/Linux the file must be
// a regular executable AND start with ELF or Mach-O magic bytes — the +x check
// alone is not enough, because engine archives ship chmodded helper scripts
// (net.sh, get_native_properties.sh) and Makefiles that would otherwise
// register as engines.
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
	if !info.Mode().IsRegular() || info.Mode()&0111 == 0 {
		return false
	}
	return hasNativeExecutableMagic(path)
}

// hasNativeExecutableMagic returns true if the file starts with ELF or Mach-O
// (including fat/universal) magic bytes. PE binaries are intentionally excluded
// on non-Windows: Windows .exe files cannot execute on Mac/Linux and should
// not be registered as engines there.
func hasNativeExecutableMagic(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var hdr [4]byte
	n, _ := io.ReadFull(f, hdr[:])
	if n < 4 {
		return false
	}
	switch {
	case hdr[0] == 0x7f && hdr[1] == 'E' && hdr[2] == 'L' && hdr[3] == 'F':
		return true
	case hdr[0] == 0xce && hdr[1] == 0xfa && hdr[2] == 0xed && hdr[3] == 0xfe:
		return true
	case hdr[0] == 0xcf && hdr[1] == 0xfa && hdr[2] == 0xed && hdr[3] == 0xfe:
		return true
	case hdr[0] == 0xfe && hdr[1] == 0xed && hdr[2] == 0xfa && hdr[3] == 0xce:
		return true
	case hdr[0] == 0xfe && hdr[1] == 0xed && hdr[2] == 0xfa && hdr[3] == 0xcf:
		return true
	case hdr[0] == 0xca && hdr[1] == 0xfe && hdr[2] == 0xba && hdr[3] == 0xbe:
		return true
	}
	return false
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

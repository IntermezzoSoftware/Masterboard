package engine

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestIsEngineExecutableMagicCheck verifies that on Mac/Linux a file must both
// have the +x bit AND native-executable magic bytes before it's recognised as
// an engine binary. Prior to the magic-byte check, chmodded Makefiles and
// helper scripts from Stockfish's release archive would incorrectly register.
func TestIsEngineExecutableMagicCheck(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("magic-byte check only runs on non-Windows; Windows uses the .exe extension")
	}

	dir := t.TempDir()

	// Text file with +x (mimics Makefile or helper .sh after Stockfish extraction).
	text := filepath.Join(dir, "Makefile")
	if err := os.WriteFile(text, []byte("# make\nall:\n"), 0755); err != nil {
		t.Fatal(err)
	}

	// Fake ELF binary with +x.
	elf := filepath.Join(dir, "stockfish")
	elfBytes := append([]byte{0x7f, 'E', 'L', 'F'}, bytes.Repeat([]byte{0}, 100)...)
	if err := os.WriteFile(elf, elfBytes, 0755); err != nil {
		t.Fatal(err)
	}

	// Windows .exe on Mac/Linux: has MZ magic but is Windows-only. We
	// intentionally exclude PE from hasNativeExecutableMagic on non-Windows
	// so users don't end up with a Windows binary registered as a Mac engine.
	winExe := filepath.Join(dir, "stockfish-windows.exe")
	mzBytes := append([]byte{'M', 'Z'}, bytes.Repeat([]byte{0}, 100)...)
	if err := os.WriteFile(winExe, mzBytes, 0755); err != nil {
		t.Fatal(err)
	}

	if isEngineExecutable(text, "Makefile") {
		t.Error("Makefile with +x should not register as an engine")
	}
	if !isEngineExecutable(elf, "stockfish") {
		t.Error("ELF binary with +x should register as an engine")
	}
	if isEngineExecutable(winExe, "stockfish-windows.exe") {
		t.Error("PE .exe should not register as an engine on non-Windows")
	}
}

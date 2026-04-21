//go:build windows

package engine

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW prevents Windows from allocating a console for the child process.
// Without this, a GUI app spawning a console subprocess (like Stockfish) causes
// Windows to create a new console window for the child, which flashes on screen.
// Reference: https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags
const createNoWindow = 0x08000000

// configureSysProcAttr suppresses the console window Windows would otherwise
// create for engine subprocesses launched from the GUI binary.
func configureSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}

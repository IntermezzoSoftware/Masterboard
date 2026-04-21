//go:build !windows

package engine

import "os/exec"

// configureSysProcAttr is a no-op on non-Windows platforms. Unix systems don't
// allocate console windows for subprocesses spawned from GUI applications.
func configureSysProcAttr(_ *exec.Cmd) {}

//go:build !windows

package engine

import "syscall"

// setHighPriority lowers the nice value to -5 (higher scheduling priority).
// Requires elevated privileges on most Unix systems; errors are silently ignored.
func setHighPriority(pid int) {
	syscall.Setpriority(syscall.PRIO_PROCESS, pid, -5) //nolint:errcheck
}

// setBelowNormalPriority raises the nice value to 10 so the OS scheduler
// prefers interactive processes. Any process may lower its own priority, so
// this succeeds without elevated privileges.
func setBelowNormalPriority(pid int) {
	syscall.Setpriority(syscall.PRIO_PROCESS, pid, 10) //nolint:errcheck
}

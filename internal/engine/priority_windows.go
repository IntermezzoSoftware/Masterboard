//go:build windows

package engine

import "golang.org/x/sys/windows"

// setHighPriority raises the process priority to HIGH_PRIORITY_CLASS on Windows.
// This is best-effort: errors are silently ignored so a permission failure
// never prevents the engine from starting.
func setHighPriority(pid int) {
	h, err := windows.OpenProcess(windows.PROCESS_SET_INFORMATION, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	windows.SetPriorityClass(h, windows.HIGH_PRIORITY_CLASS) //nolint:errcheck
}

// setBelowNormalPriority lowers the process priority to BELOW_NORMAL_PRIORITY_CLASS
// on Windows so that interactive processes are always preferred by the scheduler.
// This is best-effort: errors are silently ignored.
func setBelowNormalPriority(pid int) {
	h, err := windows.OpenProcess(windows.PROCESS_SET_INFORMATION, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	windows.SetPriorityClass(h, windows.BELOW_NORMAL_PRIORITY_CLASS) //nolint:errcheck
}

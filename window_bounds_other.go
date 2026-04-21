//go:build !windows

package main

// isWindowRectVisible is a no-op on non-Windows platforms. macOS and most
// Linux window managers already clamp out-of-bounds window positions to a
// visible display automatically, so no explicit validation is needed.
func isWindowRectVisible(_, _, _, _ int) bool { return true }

// setWindowPositionAbsolute is Windows-only; on other platforms Wails'
// WindowSetPosition is used directly (it does not exhibit the work-rect
// offset bug that the Windows winc backend has).
func setWindowPositionAbsolute(_ string, _, _ int) bool { return false }

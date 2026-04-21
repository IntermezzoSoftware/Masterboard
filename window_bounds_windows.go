//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// Windows-specific helpers for saved-window-geometry restore. Wails v2's own
// WindowSetPosition has two problems that make it unusable for this task:
//
//  1. It adds the current monitor's work-rect origin to the given (x, y)
//     coordinates (see winc/controlbase.go SetPos), while WindowGetPosition
//     returns absolute screen coordinates. Save/restore are not inverses,
//     which drifts the window by the work-rect origin on every launch when
//     the taskbar is on the top or left.
//  2. Wails v2 does not expose monitor origins through its Screen type
//     (only sizes), so we cannot validate a saved absolute position against
//     connected displays using the Wails runtime alone.
//
// Both fixes require calling user32 directly.

// modUser32 and procFindWindowW are declared in titlebar_windows.go and
// shared across the package.
var (
	procMonitorFromRect = modUser32.NewProc("MonitorFromRect")
	procSetWindowPos    = modUser32.NewProc("SetWindowPos")
)

const (
	monitorDefaultToNull = 0x00000000

	hwndTop       = 0
	swpNoSize     = 0x0001
	swpNoZOrder   = 0x0004
	swpNoActivate = 0x0010
)

type rect struct {
	Left, Top, Right, Bottom int32
}

// isWindowRectVisible returns true if the given window rectangle intersects
// at least one currently-connected display. Implemented via MonitorFromRect
// with MONITOR_DEFAULTTONULL, which returns NULL when no display intersects.
func isWindowRectVisible(x, y, w, h int) bool {
	r := rect{
		Left:   int32(x),
		Top:    int32(y),
		Right:  int32(x + w),
		Bottom: int32(y + h),
	}
	ret, _, _ := procMonitorFromRect.Call(
		uintptr(unsafe.Pointer(&r)),
		uintptr(monitorDefaultToNull),
	)
	return ret != 0
}

// setWindowPositionAbsolute positions the app's main window at the given
// absolute screen coordinates, bypassing Wails' WindowSetPosition (which
// applies a monitor-relative offset). Size is left unchanged — call
// wailsRuntime.WindowSetSize first for DPI-correct sizing. Returns false
// if the window cannot be located.
//
// The window is looked up by the Wails class name ("wailsWindow") and the
// app title, which is unique enough to reliably identify our main HWND.
func setWindowPositionAbsolute(title string, x, y int) bool {
	className, err := syscall.UTF16PtrFromString("wailsWindow")
	if err != nil {
		return false
	}
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return false
	}
	hwnd, _, _ := procFindWindowW.Call(
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(titlePtr)),
	)
	if hwnd == 0 {
		return false
	}
	ret, _, _ := procSetWindowPos.Call(
		hwnd,
		uintptr(hwndTop),
		uintptr(x),
		uintptr(y),
		0, 0,
		uintptr(swpNoSize|swpNoZOrder|swpNoActivate),
	)
	return ret != 0
}

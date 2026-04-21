//go:build !windows

package main

// registerProtocol is a no-op on non-Windows platforms. Mac registers the
// scheme via CFBundleURLTypes in Info.plist; Linux via the .desktop file.
func (a *App) registerProtocol() {}

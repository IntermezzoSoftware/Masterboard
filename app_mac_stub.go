//go:build !darwin

package main

// SetMacDockIcon is a no-op on non-macOS platforms.
func (a *App) SetMacDockIcon(dark bool) {}

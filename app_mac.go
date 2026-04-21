//go:build darwin

package main

// Full CGo implementation is deferred — this stub ensures the Wails binding is available.
func (a *App) SetMacDockIcon(dark bool) {}

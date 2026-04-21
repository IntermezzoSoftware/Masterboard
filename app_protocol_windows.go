//go:build windows

package main

import (
	"log"
	"os"

	"golang.org/x/sys/windows/registry"
)

// registerProtocol writes the masterboard:// URI scheme handler into
// HKCU\Software\Classes so the OS routes OAuth callbacks back to this
// executable. HKCU doesn't require admin rights and takes precedence over
// HKLM, so this works in both dev mode and alongside the NSIS installer.
func (a *App) registerProtocol() {
	exe, err := os.Executable()
	if err != nil {
		log.Printf("registerProtocol: get executable path: %v", err)
		return
	}

	base := `Software\Classes\io.masterboard.app`
	k, _, err := registry.CreateKey(registry.CURRENT_USER, base, registry.SET_VALUE)
	if err != nil {
		log.Printf("registerProtocol: create key: %v", err)
		return
	}
	k.SetStringValue("", "Masterboard")
	k.SetStringValue("URL Protocol", "")
	k.Close()

	cmd, _, err := registry.CreateKey(registry.CURRENT_USER, base+`\shell\open\command`, registry.SET_VALUE)
	if err != nil {
		log.Printf("registerProtocol: create command key: %v", err)
		return
	}
	cmd.SetStringValue("", `"`+exe+`" "%1"`)
	cmd.Close()
}

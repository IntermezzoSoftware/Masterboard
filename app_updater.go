package main

import (
	"log"

	"github.com/IntermezzoSoftware/Masterboard/internal/updater"
	"github.com/IntermezzoSoftware/Masterboard/internal/version"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// checkAndEmitUpdate runs in a goroutine from domReady. If a newer release
// is available on GitHub, it emits "app:update-available" with the version string.
func (a *App) checkAndEmitUpdate() {
	latest, err := updater.CheckForUpdate(version.Current)
	if err != nil {
		log.Printf("update check: %v", err)
		return
	}
	if latest != "" {
		log.Printf("update available: %s (current: %s)", latest, version.Current)
		a.emitFn("app:update-available", latest)
	}
}

func (a *App) OpenURL(url string) {
	wailsRuntime.BrowserOpenURL(a.ctx, url)
}

// IsSetupComplete reports whether the user has completed the first-run setup wizard.
func (a *App) IsSetupComplete() bool {
	if a.db == nil {
		return true // no DB = don't block the user
	}
	val, err := a.db.GetSetting("setup.complete")
	if err != nil {
		return true
	}
	return val == "true"
}

func (a *App) MarkSetupComplete() {
	if a.db == nil {
		return
	}
	if err := a.db.SetSetting("setup.complete", "true"); err != nil {
		log.Printf("MarkSetupComplete: %v", err)
	}
}

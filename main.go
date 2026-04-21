package main

import (
	"embed"
	"log"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	wailsWindows "github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Handle OAuth callback redirects before starting the full app.
	// When the OS launches a new instance via the io.masterboard.app:// URI
	// scheme handler, we write the URL to a temp file for the running instance
	// to read, then exit immediately — no window, no DB, no Wails startup.
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "io.masterboard.app://") {
			if err := os.WriteFile(oauthCallbackPath(), []byte(arg), 0600); err != nil {
				log.Printf("oauth callback forward: %v", err)
			}
			return
		}
	}

	// Create an instance of the app structure. The DB is opened inside NewApp
	// so that saved window geometry is available before wails.Run is called.
	app := NewApp()

	// If we have a saved geometry, start hidden so we can reposition before
	// the window becomes visible (avoids the centre-then-jump flash).
	_, _, _, _, _, hasSavedGeometry := app.SavedWindowGeometry()

	// Allow the perf harness to isolate WebView2 state (localStorage, panel
	// layout, etc.) per test by pointing WebviewUserDataPath at a per-run
	// temp directory via MASTERBOARD_WEBVIEW_USER_DATA_PATH. In release builds
	// this env var is never set, so WebView2 uses its default path — behavior
	// is byte-identical to upstream.
	var windowsOpts *wailsWindows.Options
	if p := os.Getenv("MASTERBOARD_WEBVIEW_USER_DATA_PATH"); p != "" {
		windowsOpts = &wailsWindows.Options{WebviewUserDataPath: p}
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:       "Masterboard",
		Width:       1280,
		Height:      800,
		Frameless:   true,
		StartHidden: hasSavedGeometry,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 252, G: 252, B: 253, A: 255},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About: &mac.AboutInfo{
				Title:   "Masterboard",
				Message: "© 2026 Intermezzo Software\nhttps://masterboard.io",
				Icon:    appIconDark,
			},
			OnUrlOpen: app.handleOAuthCallback,
		},
		Windows: windowsOpts,
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

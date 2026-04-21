module github.com/IntermezzoSoftware/Masterboard

go 1.26

require (
	github.com/corentings/chess/v2 v2.3.8
	github.com/google/uuid v1.6.0
	github.com/klauspost/cpuid/v2 v2.3.0
	github.com/mattn/go-sqlite3 v1.14.40
	github.com/open-spaced-repetition/go-fsrs/v4 v4.0.0-20260303120529-d04da2a1b633
	github.com/pbnjay/memory v0.0.0-20210728143218-7b4eea64cf58
	github.com/wailsapp/wails/v2 v2.12.0
	golang.org/x/sync v0.20.0
	golang.org/x/sys v0.42.0
	modernc.org/sqlite v1.48.0
)

require (
	git.sr.ht/~jackmordaunt/go-toast/v2 v2.0.3 // indirect
	github.com/bep/debounce v1.2.1 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	github.com/labstack/echo/v4 v4.15.1 // indirect
	github.com/labstack/gommon v0.4.2 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.1 // indirect
	github.com/leaanthony/gosod v1.0.4 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.1 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/pkg/browser v0.0.0-20240102092130-5ac0b6a4141c // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/samber/lo v1.53.0 // indirect
	github.com/tkrajina/go-reflector v0.5.8 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	github.com/wailsapp/go-webview2 v1.0.23 // indirect
	github.com/wailsapp/mimetype v1.4.1 // indirect
	golang.org/x/crypto v0.49.0 // indirect
	golang.org/x/exp v0.0.0-20260312153236-7ab1446f8b90 // indirect
	golang.org/x/net v0.52.0 // indirect
	golang.org/x/text v0.35.0 // indirect
	modernc.org/libc v1.70.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

// Masterboard perf harness uses a locally-patched go-webview2 to allow
// injecting Chromium switches (specifically --remote-debugging-port) via
// the MASTERBOARD_PERF_WEBVIEW_ARGS env var at WebView2 embed time.
// The patch is inert when that env var is unset, so release builds get
// upstream behavior. See third_party/go-webview2/PATCH_NOTES.md.
replace github.com/wailsapp/go-webview2 => ./third_party/go-webview2

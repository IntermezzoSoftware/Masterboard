# Masterboard patch for `github.com/wailsapp/go-webview2 v1.0.23`

## Why this fork exists

The Masterboard performance harness needs to drive the release-shaped Wails
binary over the Chrome DevTools Protocol so Playwright can attach to the real
WebView2 instance, script real interactions, and record RAF-based frame metrics
with Stockfish, SQLite, and the full Go IPC surface in the loop.

CDP is enabled in WebView2 by passing `--remote-debugging-port=<n>` as a
browser switch. Microsoft's documented ways to inject that switch
(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, the registry group-policy path, and
the COM `CoreWebView2EnvironmentOptions.AdditionalBrowserArguments` property)
all end up gated behind Wails' `go-webview2` wrapper, which does three things
that make those paths unreachable from a Wails v2 application:

1. `webviewloader/env_create.go:init()` runs at package load time and
   unconditionally calls `preventEnvAndRegistryOverrides()`, which clears
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (and friends) to the empty string.
   Anything the parent process set is gone before `main()` runs.
2. On the default (non-`native_webview2loader`) build path the Go loader
   never reads that env var at runtime anyway — browser arguments come
   exclusively from the Go field `edge.Chromium.AdditionalBrowserArgs`.
3. Wails v2 `pkg/options/windows.Options` does not expose
   `AdditionalBrowserArgs` as a public option. Wails v3 alpha did add it;
   Wails v2 has no supported injection point for arbitrary Chromium switches.

The net effect is that `Chromium.AdditionalBrowserArgs` is the **only**
channel that actually reaches WebView2, and nothing in user Go code or the
child-process environment can populate it.

## The patch

One file, one hunk, ~14 lines including comments — injected inside
`Chromium.Embed` in `pkg/edge/chromium.go`, at the point where
`AdditionalBrowserArgs` is joined into the string passed to
`createCoreWebView2EnvironmentWithOptions`:

```go
browserArgs := strings.Join(e.AdditionalBrowserArgs, " ")
// Masterboard patch …
if extra := os.Getenv("MASTERBOARD_PERF_WEBVIEW_ARGS"); extra != "" {
    if browserArgs == "" {
        browserArgs = extra
    } else {
        browserArgs = browserArgs + " " + extra
    }
}
if err := createCoreWebView2EnvironmentWithOptions(...); err != nil {
```

Properties:

- **One single injection point covers both loader paths.** The `go` loader
  (`webviewloader/env_create.go`) and the `native_webview2loader` path
  (`webviewloader/native_module.go`) both receive `browserArgs` from this
  line via `createCoreWebView2EnvironmentWithOptions`. Patching at the
  chromium-level join means the fix is inherited by both.
- **Runs at `Embed()` time, not at init.** That's after Wails has finished
  calling `preventEnvAndRegistryOverrides()`, so the env var value is still
  available when we read it.
- **Masterboard-specific variable name.** Reusing
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` would be clobbered by Wails at
  package init. A distinct name (`MASTERBOARD_PERF_WEBVIEW_ARGS`) keeps
  clear of that machinery.
- **Inert in release builds.** Release builds of Masterboard never set
  `MASTERBOARD_PERF_WEBVIEW_ARGS`, so the branch short-circuits and the
  behavior is byte-identical to upstream. No `-tags perf` gate is required.

## Upgrading to a newer `go-webview2`

When bumping to a newer tag, re-vendor the tree, then re-apply the patch
to whatever the upstream equivalent of `pkg/edge/chromium.go:Chromium.Embed`
looks like — the join-and-call pattern has been stable across recent
versions, so the patch should re-apply near-verbatim.

The `replace` directive lives in the repo-root `go.mod`:

```
replace github.com/wailsapp/go-webview2 => ./third_party/go-webview2
```

If upstream Wails ever adopts a public `AdditionalBrowserArgs` field on
`windows.Options` (Wails v3 already has one), this patch becomes obsolete
and can be deleted along with the vendored tree and the replace directive.

# Masterboard Performance Harness

Automated animation-smoothness and IPC-responsiveness tests. Two pipelines:

| Pipeline | Command (from repo root) | Target | When to use |
|---|---|---|---|
| Real binary (primary) | `task perf` | instrumented `Masterboard.exe` via CDP | end-to-end perf: chessground + Wails IPC + Go + SQLite + real Stockfish |
| Vite preview (fallback) | `task perf:fe` | production React bundle + `e2e/fixtures.ts` mock | fast pure-frontend smoke check, scenario development without a Go rebuild |

`task perf` builds the instrumented binary first via its `build:perf` dependency. If you prefer to skip Task, the raw paths are `wails build -tags perf && cd frontend && npm run perf` and `cd frontend && npm run perf:fe` respectively — `npm run perf` assumes the instrumented binary already exists, it does not rebuild it.

Results land in:

- `frontend/perf-results.jsonl` — one JSON record per scenario per run
- `frontend/perf-playwright.json` — Playwright's own per-test report

## The `perf` Go build tag

All instrumentation lives behind `//go:build perf`. Release builds (`wails build`) contain **zero** perf code — the stubs in `app_perf_stub.go` are inlined away. The harness requires an instrumented binary:

```sh
wails build -tags perf
```

The harness's `globalSetup` refuses to run without a matching binary, and the per-test fixture pings `__perf:ack` on startup to verify the handshake. If that ping fails, you're pointed at a release binary — rebuild with `-tags perf`.

Override the binary path with:

```sh
MASTERBOARD_PERF_BINARY=/abs/path/to/Masterboard.exe npm run perf
```

## Stockfish requirement

The `engine-stream` and `engine-multipv` scenarios drive real Stockfish through the Engine panel's Start button. On startup the binary calls `engine.DefaultEngines(<execDir>)` and `engine.DefaultEngines(<execDir>/..)` looking for an engine executable under `engines/`. For a binary at `build/bin/Masterboard.exe` that means the discovery paths are `build/bin/engines/` and `build/engines/`.

On a fresh clone (or a fresh git worktree — `build/` is gitignored), the engines directory is empty. Both engine scenarios will then skip with "engine-start-btn never enabled". To run them, drop a Stockfish binary into either discovery path before invoking `task perf`:

```sh
# From the worktree root
mkdir -p build/engines
cp /path/to/stockfish-windows-x86-64-avx2.exe build/engines/
```

Alternatively, put any `stockfish` binary on `PATH` — `engine.DefaultEngines` falls back to `exec.LookPath("stockfish")` after the bundled-engines scan. The non-engine scenarios are unaffected and run fine without either.

## How the real-binary pipeline works

1. `globalSetup` clears `perf-results.jsonl` and asserts the binary exists.
2. For each scenario, the per-test fixture spawns the binary with:
   - `MASTERBOARD_PERF_WEBVIEW_ARGS=--remote-debugging-port=<port>` — consumed by Masterboard's locally-patched `go-webview2` to expose the Chromium DevTools Protocol on WebView2 (see the "Patched go-webview2" section below for why the standard `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var does not work in a Wails v2 app)
   - `MASTERBOARD_DATA_DIR=<temp>` — redirects SQLite + master DB to an isolated temp directory, never touching the user's real data
   - `MASTERBOARD_WEBVIEW_USER_DATA_PATH=<temp>/webview2` — redirects WebView2's own profile (Chromium localStorage, cookies, cache) to a fresh directory per run, so persisted panel layouts and UI state do not bleed between tests. Read by `main.go` and passed to Wails via `windows.Options.WebviewUserDataPath`. Empty in release builds, so upstream Wails behavior is preserved.
3. The fixture polls `http://localhost:<port>/json/version` until the CDP endpoint is live.
4. Playwright connects via `chromium.connectOverCDP(...)` and grabs the existing page.
5. A `__perf:ping` event is emitted on the Wails event bus and the fixture waits for `__perf:ack` — confirms the binary was built with `-tags perf`.
6. The scenario runs: scripts an interaction, records frames via RAF, asserts smoothness thresholds.
7. Teardown kills the process and removes the temp data dir.

Fresh per test: ~3 s boot overhead × N scenarios. Trivial compared to chasing state bleed between tests.

## Perf-only Wails event handlers

The instrumented binary exposes these on the Wails event bus (never visible in release builds — see `app_perf.go`):

| Event | Arg | Ack | Purpose |
|---|---|---|---|
| `__perf:ping` | — | `{cmd:"ping", payload:{ready:true}}` | Handshake — must answer within 2 s |
| `__perf:seed-games` | `count: number` | `{cmd:"seed-games", payload:{inserted:N}}` | Bulk-insert N synthetic games (bypasses real PGN import) |
| `__perf:reset` | — | `{cmd:"reset"}` | Truncate games table + position-index (schema preserved) |

Emit from a scenario via `page.evaluate`:

```ts
await page.evaluate(async () => {
  const w = window as any
  await new Promise<void>((resolve) => {
    w.runtime.EventsOnce('__perf:ack', () => resolve())
    w.runtime.EventsEmit('__perf:seed-games', 2000)
  })
})
```

## Scenarios and regression classes

The suite covers seven perf-regression classes. Each scenario targets a specific class and has thresholds tuned for that class's operating budget.

| Scenario | Class | What it measures | Key thresholds |
|---|---|---|---|
| `piece-moves` | A — frame smoothness during animation | Chessground animation under move pressure | `fps ≥ 55`, `max_ms ≤ 50` |
| `dialog-cycles` | A — frame smoothness during animation | Dialog open/close keyframe cost | `fps ≥ 55`, `max_ms ≤ 50` |
| `panel-drag` | A — frame smoothness during animation | Workspace panel drag / resize | `fps ≥ 55`, `max_ms ≤ 50` |
| `theme-toggle` | A — frame smoothness during animation | Light/dark theme swap | `fps ≥ 55`, `max_ms ≤ 50` |
| `games-list-scroll` | B — virtualized list render | 2000-row list scroll smoothness | `fps ≥ 55`, `max_ms ≤ 50` |
| `engine-stream` | C — high-freq IPC → re-render (single stream) | 5 s of single-PV Stockfish analysis | `fps ≥ 55`, `dropped ≤ 3 %`, `max_ms ≤ 50` |
| **`masterdb-query`** | **D — per-interaction IPC round-trip latency** | 20 ply steps, each firing `GetMasterPositionStats` + `GetMasterGamesAtPosition` | `fps ≥ 55`, `max_ms ≤ 60` |
| **`pgn-import`** | **E — UI responsiveness while Go is busy** | 500-game import while measuring UI frame cadence | `fps ≥ 45`, `longDropped = 0` (no > 100 ms freeze) |
| **`engine-multipv`** | **F — parallel IPC multiplier** | 5 s of 5-line Stockfish (≈ 5× event rate) | `fps ≥ 55`, `dropped ≤ 3 %`, `max_ms ≤ 50` |
| **`folder-tree`** | **G — non-virtualized hierarchical render** | 110-folder hierarchy, 10 expand/collapse toggles | `fps ≥ 55`, `max_ms ≤ 50` |

## Fixture DBs

`frontend/perf/fixtures/` holds pre-built SQLite DBs used by scenarios that need bulk state:

- **`small.pgn`** — 500 deterministic synthetic games sharing a 10-ply Ruy Lopez line. Used directly by `pgn-import.perf.ts` and fed into the master DB for `masterdb-query.perf.ts`.
- **`masterdb-small/`** — a three-file split master DB (`masterboard_master.db`, `..._stats.db`, `..._index.db`) built from `small.pgn`. Used by `masterdb-query.perf.ts` so each run does not pay the import cost. The launcher shallow-copies every `*.db` file in this directory into the temp data dir before spawn — see `wails-launcher.ts`'s `fixtureMasterDir` option.

Generate them once:

```sh
task perf:fixtures     # preferred
npm run perf:fixtures  # equivalent
```

The generator (`scripts/generate-perf-fixtures.ts`) launches an instrumented binary, writes `small.pgn`, calls real `StartMasterDBImport` via bound IPC, waits for `masterdb:complete`, then copies the resulting split DB files into `fixtures/masterdb-small/` before disposing the binary. Re-run whenever the master DB schema changes; check the generated files into git.

Scenarios opt into a fixture via `test.use`:

```ts
// Single-file game DB copied to masterboard.db
test.use({ perfFixture: { fixture: 'games-2000.db' } })

// Multi-file master DB directory
test.use({ perfFixture: { masterFixture: 'masterdb-small' } })
```

## Frame-smoothness metrics

`perf-utils.ts` provides `startFrameRecording` / `stopFrameRecording`. Per scenario:

- `totalFrames` — RAF callbacks captured
- `mean_ms`, `median_ms`, `p95_ms`, `max_ms` — frame delta distribution
- `dropped` — frames with delta > 20 ms (below 50 FPS)
- `longDropped` — frames with delta > 100 ms (visibly stuttering hitches)
- `effectiveFps` — `1000 / mean_ms`

`assertSmooth(metrics, { minFps, maxDroppedPct, maxFrameMs, maxLongDropped })` throws with full metrics on violation. Defaults: 55 FPS, 5 %, 50 ms, unchecked. `maxLongDropped` is used by scenarios like `pgn-import` where Go is legitimately busy but the UI must never freeze for more than 100 ms at a stretch.

## Adding a scenario

1. Create `frontend/perf/scenarios/<name>.perf.ts` (real binary) or `<name>.perf.fe.ts` (Vite preview).
2. Import `test`, `expect` from `./test-fixtures` (real) or `./fe-fixtures` (preview).
3. Optionally tag with a fixture:
   ```ts
   test.use({ perfFixture: { fixture: 'games-2000.db' } })
   test.use({ perfFixture: { masterFixture: 'masterdb-small' } })
   ```
4. Script the interaction, wrap with `startFrameRecording` / `stopFrameRecording`.
5. Call `assertSmooth(metrics, {...}, scenarioName)`.
6. Call `writeReport(reportPath, scenarioName, metrics)` so the JSONL baseline gets the new entry.

## Manual deep-dive path

When automation flags a regression but doesn't explain why:

```sh
wails build -debug
./build/bin/Masterboard.exe
```

A Wails debug build opens WebView2 DevTools on startup. Use the Performance tab to record a real user session, load the trace in chrome://tracing, attribute slowness to specific JS / layout / paint work.

## Windows-only caveat

The real-binary pipeline depends on WebView2's `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var, which is Windows-specific. macOS and Linux Wails builds use WKWebView / WebKit2GTK respectively and need a different approach (probably WebInspector's `--inspect-brk` on macOS; TBD for Linux). Out of scope for v1. The `perf:fe` fallback runs on any platform.

## Patched go-webview2

The real-binary pipeline needs `--remote-debugging-port` to reach Chromium inside the WebView2 that Wails embeds. None of Microsoft's documented paths for that switch (the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var, the registry group-policy key, or the COM `AdditionalBrowserArguments` field) actually work in a Wails v2 app:

- `go-webview2/webviewloader/env_create.go:init()` runs at package load time and unconditionally clears `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` to the empty string (`preventEnvAndRegistryOverrides`). Anything the parent process set is gone before `main()` runs.
- On the default Wails loader path the env var is never read at runtime anyway — browser arguments come exclusively from the Go field `edge.Chromium.AdditionalBrowserArgs`.
- Wails v2 `windows.Options` does not expose `AdditionalBrowserArgs` as a public option. Wails v3 alpha did add it; v2 has no supported injection point.

So the only channel that actually reaches Chromium in a Wails v2 app is `Chromium.AdditionalBrowserArgs`, and nothing in user Go code or the child-process environment can populate it.

To unblock the harness, Masterboard ships a **locally-patched `go-webview2`** under `third_party/go-webview2/`, wired in via a `replace` directive in the repo-root `go.mod`. The patch is ~14 lines (one hunk in `pkg/edge/chromium.go:Chromium.Embed`) and adds a single late-binding env-var read inside `Embed()`:

```go
browserArgs := strings.Join(e.AdditionalBrowserArgs, " ")
if extra := os.Getenv("MASTERBOARD_PERF_WEBVIEW_ARGS"); extra != "" {
    if browserArgs == "" {
        browserArgs = extra
    } else {
        browserArgs = browserArgs + " " + extra
    }
}
```

Because the read happens at `Embed()` time it runs after Wails' init-time `preventEnvAndRegistryOverrides()` has finished, and because the variable name is Masterboard-specific it sidesteps Wails' clobber entirely. The patch covers both go-webview2 loader paths (default and `native_webview2loader`) via the single join point.

The patch is inert in release builds: no code sets `MASTERBOARD_PERF_WEBVIEW_ARGS`, so the branch short-circuits and behavior is byte-identical to upstream `go-webview2`. No `-tags perf` gate is required.

See `third_party/go-webview2/PATCH_NOTES.md` for the full explanation and instructions for re-applying the patch when bumping the vendored tag.

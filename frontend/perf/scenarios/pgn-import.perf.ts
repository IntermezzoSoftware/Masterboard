import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * PGN import UI responsiveness. Starts with an empty fixture DB, then invokes
 * the real `ImportPGNFile` bound IPC against `fixtures/small.pgn` (500 games,
 * checked in). Records frames for the full duration of the import — Go is
 * hammering SQLite, the JS thread is only responsible for keeping the event
 * loop healthy.
 *
 * What regression this catches:
 *   - A synchronous loop on the render thread that blocks rAF
 *   - Floods of un-throttled progress events on the Wails bus
 *   - A regression that parks the UI inside an import callback
 *
 * Unlike the other scenarios this is a **long-running** test — bump the per
 * test timeout to 60 s because `saveMany` on 500 games does real work.
 */

// 60 s — the import is the slow part of the scenario and the rest of the
// harness is already fast. Don't let Playwright's default 30 s terminate us.
test.setTimeout(60_000)

// Use an empty fixture — we want the DB to be populated *by the import*,
// not pre-populated, because that's what a real user's first import looks
// like.
test.use({ perfFixture: {} })

test('pgn-import: import 500-game PGN while measuring UI responsiveness', async ({ wailsPage: page }) => {
  const scenario = 'pgn-import'
  const here = path.dirname(fileURLToPath(import.meta.url))
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(here, '..', '..', 'perf-results.jsonl')
  const pgnPath = path.resolve(here, '..', 'fixtures', 'small.pgn')

  // Verify the bound ImportPGNFile method is available on window.go. If the
  // user hasn't regenerated perf fixtures the Go binding should still exist,
  // but fail fast if for any reason it doesn't.
  await page.waitForFunction(() => {
    const w = window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }
    return Boolean(w.go?.main?.App?.ImportPGNFile)
  }, { timeout: 5000 })

  await startFrameRecording(page)

  // Kick the import off via the bound IPC. The Go side does all the work;
  // the JS thread is only responsible for keeping rAF alive while it waits
  // for the promise to resolve. That's the entire regression target.
  const importedIds = await page.evaluate(async (p: string) => {
    const w = window as unknown as {
      go: { main: { App: { ImportPGNFile: (path: string) => Promise<string[]> } } }
    }
    return await w.go.main.App.ImportPGNFile(p)
  }, pgnPath)

  const metrics = await stopFrameRecording(page)

  expect(importedIds.length).toBeGreaterThan(0)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)

  // Thresholds tuned for "Go is legitimately busy, UI must stay responsive":
  //   - fps ≥ 45 (lower floor accepted during heavy background work)
  //   - longDropped (> 100 ms) must be 0 — no visible freeze
  //   - max_ms is not asserted; a single 80 ms blip is OK during import
  assertSmooth(
    metrics,
    { minFps: 45, maxDroppedPct: 0.20, maxFrameMs: Number.POSITIVE_INFINITY, maxLongDropped: 0 },
    scenario,
  )
})

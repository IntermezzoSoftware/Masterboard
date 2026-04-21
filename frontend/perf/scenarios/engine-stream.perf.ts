import path from 'node:path'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Engine info stream smoothness. Starts real Stockfish against the starting
 * position via the Engine panel's Start button, records 5 s of frames while
 * engine:info events stream back over the Wails event bus.
 *
 * This is the highest-value real-binary scenario: it's the only one that
 * exercises high-frequency IPC (engine depth updates can fire dozens per
 * second) through the full Go → Wails event bus → React re-render chain. A
 * frontend-only harness would miss this entirely because it would never
 * cross the bridge.
 *
 * Preconditions:
 *   - The binary must have a default engine configured and usable. If Engine
 *     Start remains disabled after 2 s, the test is skipped.
 */
test('engine-stream: 5s real Stockfish analysis', async ({ wailsPage: page }) => {
  const scenario = 'engine-stream'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results.jsonl')

  // The Engine panel is one of the default panels on the Home page.
  const startBtn = page.getByTestId('engine-start-btn')
  try {
    await startBtn.waitFor({ state: 'visible', timeout: 2000 })
  } catch {
    test.skip(true, 'Engine panel not visible — skipping engine-stream (enable default Engine panel to run).')
  }

  // Wait up to 10 s for the engine to launch and the Start button to enable.
  // Stockfish cold start can take several seconds on a fresh data dir. If the
  // button never enables, the machine has no configured engine — skip.
  try {
    await expect(startBtn).toBeEnabled({ timeout: 10000 })
  } catch {
    test.skip(true, 'No usable engine configured on this machine — engine-start-btn never enabled.')
  }

  await startBtn.click()

  await startFrameRecording(page)
  // 5 seconds of streaming — long enough for depth to climb into the teens
  // on any modern CPU, which is where the event rate peaks.
  await page.waitForTimeout(5000)
  const metrics = await stopFrameRecording(page)

  // Stop the engine so teardown is clean.
  await page.getByTestId('engine-stop-btn').click().catch(() => { /* ignore if already stopped */ })

  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  // Tighter threshold for this scenario — the main thread should stay above
  // 55 FPS even under IPC pressure. A regression here means the React
  // subtree subscribed to engine events is re-rendering too much.
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.03, maxFrameMs: 50 }, scenario)
})

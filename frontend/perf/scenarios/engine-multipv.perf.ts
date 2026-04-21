import path from 'node:path'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Multi-PV engine stream smoothness. Identical to `engine-stream.perf.ts`
 * except the Engine panel is switched to 5-line mode before Start is clicked,
 * so Stockfish emits ~5× as many `engine:info` events (one per PV per depth
 * increment). Records 5 s of frames while the stream is live.
 *
 * What regression this catches:
 *   - Accidental removal of batching / throttling in the engine:info handler
 *   - Engine subtree re-renders scaling linearly with the number of PVs
 *   - Parallel IPC multiplier (class F): single-PV can stay green while
 *     multi-PV silently tanks
 *
 * Thresholds are tighter than single-PV on purpose — if multi-PV can't hold
 * 55 FPS with 5 parallel lines we want to know immediately.
 */
test('engine-multipv: 5s real Stockfish analysis at 5 lines', async ({ wailsPage: page }) => {
  const scenario = 'engine-multipv'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results.jsonl')

  const startBtn = page.getByTestId('engine-start-btn')
  try {
    await startBtn.waitFor({ state: 'visible', timeout: 2000 })
  } catch {
    test.skip(true, 'Engine panel not visible — skipping engine-multipv.')
  }

  // Wait up to 10 s for the engine to launch and the Start button to enable.
  try {
    await expect(startBtn).toBeEnabled({ timeout: 10000 })
  } catch {
    test.skip(true, 'No usable engine configured on this machine — engine-start-btn never enabled.')
  }

  // Switch to 5 lines *before* starting analysis so the first StartAnalysis
  // call already runs at multiPV=5. Clicking mid-stream would restart the
  // engine internally and muddy the measurement window.
  await page.getByTestId('engine-multipv-btn-5').click()

  await startBtn.click()

  await startFrameRecording(page)
  await page.waitForTimeout(5000)
  const metrics = await stopFrameRecording(page)

  await page.getByTestId('engine-stop-btn').click().catch(() => { /* ignore if already stopped */ })

  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  // Tighter than single-PV: dropped ≤ 3 %, max frame ≤ 50 ms. A regression
  // in the engine panel's re-render path — or removal of any throttling in
  // the engine:info bridge — will surface here first.
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.03, maxFrameMs: 50 }, scenario)
})

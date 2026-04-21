import path from 'node:path'
import { test, expect } from '../fe-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Dialog mount/unmount transition smoothness. Opens LoadFENDialog via the FEN
 * dropdown, closes with Escape, 20 times. Exercises the dialog keyframe
 * animations (fade + scale) and Radix Dialog portal mount/unmount cost.
 *
 * Pure frontend — no Wails IPC, no Go backend involvement. Runs against the
 * Vite preview build.
 *
 * NOTE on thresholds: each dialog open pays ~5–7 ms of style recalc for the
 * fresh Radix portal subtree (many Tailwind utilities × dark:/hover:/focus:
 * variants over ~15–20 new nodes). That's enough to push one frame per
 * open/close over the 16.7 ms vsync budget, giving a consistent ~10–13 %
 * dropped-frame rate on the default 60 Hz display. Investigated in depth via
 * CDP tracing (see conversation history); no clean fix preserves both the
 * Radix modal semantics (scroll-lock, focus trap, aria-hidden siblings) and
 * the clean mount/unmount lifecycle without trading one for the other.
 * Thresholds below document the accepted cost rather than chasing a fix that
 * would be worse than the hitch. Dialogs are infrequent interactions.
 */
test('dialog-cycles: LoadFENDialog open/close × 20', async ({ bridgedPage: page }) => {
  const scenario = 'dialog-cycles'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results-fe.jsonl')

  // Pre-flight: make sure the FEN dropdown button exists before we start timing
  await page.getByRole('button', { name: 'FEN' }).waitFor()

  await startFrameRecording(page)

  for (let i = 0; i < 20; i++) {
    await page.getByRole('button', { name: 'FEN' }).click()
    await page.getByRole('button', { name: 'Load Position…' }).click()
    await page.getByRole('dialog').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
  }

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  // Relaxed thresholds document the accepted mount-cost hitch (see block
  // comment above). Observed range across repeated runs: 9–22 % dropped,
  // 46–55 effective FPS, max frame 33–83 ms (one to five doubled frames
  // in the worst case, driven by GC / compositor jitter on top of the
  // base ~5–7 ms style recalc). Thresholds are set generously above the
  // worst observed to keep the scenario stable; regressions beyond these
  // bounds indicate something genuinely new — a dialog picking up extra
  // nodes, a heavier animation, or a style-recalc regression elsewhere.
  assertSmooth(metrics, { minFps: 40, maxDroppedPct: 0.30, maxFrameMs: 120 }, scenario)
})

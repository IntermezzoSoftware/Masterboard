import path from 'node:path'
import { test, expect } from '../fe-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Theme toggle repaint smoothness. Flips the `.dark` class on <html> 10 times
 * and measures frames during the rapid repaints. Catches mass-repaint
 * regressions from new `.dark` style rules.
 *
 * Pure frontend — drives the theme change directly via the ThemeProvider's
 * DOM effect (toggling the class) rather than navigating to Settings. This
 * isolates the repaint cost from any routing overhead.
 */
test('theme-toggle: dark/light × 10', async ({ bridgedPage: page }) => {
  const scenario = 'theme-toggle'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results-fe.jsonl')

  await startFrameRecording(page)

  for (let i = 0; i < 10; i++) {
    await page.evaluate((darkIdx) => {
      document.documentElement.classList.toggle('dark', darkIdx % 2 === 0)
    }, i)
    // Give the browser a tick to repaint; without this the loop can batch
    // style invalidations before layout happens.
    await page.waitForTimeout(60)
  }

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.05, maxFrameMs: 50 }, scenario)
})

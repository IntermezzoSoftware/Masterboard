import path from 'node:path'
import { test, expect } from '../fe-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Panel splitter drag smoothness. Grabs the first `role=separator` element
 * (rendered by `react-resizable-panels`'s `Separator`) and drags it back and
 * forth to stress continuous resize-driven layout passes.
 *
 * Pure frontend — no IPC involved.
 */
test('panel-drag: splitter back-and-forth', async ({ bridgedPage: page }) => {
  const scenario = 'panel-drag'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results-fe.jsonl')

  // Default Board layout has at least one vertical or horizontal separator.
  const separator = page.getByRole('separator').first()
  await separator.waitFor()
  const box = await separator.boundingBox()
  if (!box) throw new Error('separator has no bounding box')

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await startFrameRecording(page)

  await page.mouse.move(startX, startY)
  await page.mouse.down()

  // 2-second sweep left/right by 100 px, ~60 steps
  const steps = 60
  for (let i = 0; i < steps; i++) {
    const phase = (i / steps) * Math.PI * 4 // two full cycles
    const dx = Math.sin(phase) * 100
    await page.mouse.move(startX + dx, startY, { steps: 2 })
    await page.waitForTimeout(30)
  }

  await page.mouse.up()

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.05, maxFrameMs: 50 }, scenario)
})

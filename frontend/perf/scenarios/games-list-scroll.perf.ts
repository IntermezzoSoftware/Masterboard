import path from 'node:path'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Games list virtualized-scroll smoothness. Uses the __perf:seed-games event
 * handler to bulk-insert 2000 synthetic games straight into SQLite (bypassing
 * the PGN parser to keep seeding quick), navigates to the Games page, and
 * scrolls continuously for 2 s.
 *
 * Exercises real `ListGames` over Wails IPC plus whatever virtualization the
 * games list uses. A regression in either the marshalling cost or the row
 * renderer shows up here.
 */
test('games-list-scroll: 2000 seeded rows, 2 s continuous scroll', async ({ wailsPage: page }) => {
  const scenario = 'games-list-scroll'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results.jsonl')

  // Seed 2000 games via the perf event handler — the tagged binary implements
  // this by looping storage.SaveGame directly.
  await page.evaluate(async () => {
    const w = window as unknown as {
      runtime: {
        EventsEmit: (name: string, ...args: unknown[]) => void
        EventsOnce: (name: string, cb: (data: unknown) => void) => void
      }
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('seed-games ack timeout')), 30_000)
      w.runtime.EventsOnce('__perf:ack', (data: unknown) => {
        clearTimeout(timeout)
        const d = data as { cmd?: string; error?: string } | undefined
        if (d?.error) reject(new Error(`seed-games failed: ${d.error}`))
        else resolve()
      })
      w.runtime.EventsEmit('__perf:seed-games', 2000)
    })
  })

  // Navigate to the Games page.
  await page.getByRole('link', { name: 'Games' }).click()
  await page.getByText('All Games').waitFor()

  // The scrollable container is the one with `overflow-y-auto` inside the
  // main games list — there's exactly one on this page.
  const list = page.locator('div.overflow-y-auto').first()
  await list.waitFor()
  const box = await list.boundingBox()
  if (!box) throw new Error('games list has no bounding box')

  // Park the cursor over the list so wheel events hit it.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

  await startFrameRecording(page)

  // 2 s of continuous wheel scrolling.
  const steps = 40
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(50)
  }

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.05, maxFrameMs: 50 }, scenario)
})

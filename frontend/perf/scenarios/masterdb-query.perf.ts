import path from 'node:path'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Master DB query smoothness: drives the single hottest Go-side path on a
 * normal user interaction. The Explorer panel fires two IPC calls on every
 * ply change (`GetMasterPositionStats` + `GetMasterGamesAtPosition` in
 * parallel — see `ExplorerPanelContent.tsx:547-565`). This scenario loads a
 * pre-built split master DB via the launcher's `fixtureMasterDir` option
 * (so we don't pay PGN-import cost every run), enables the Explorer panel
 * on the Home page, loads a Ruy Lopez PGN, and steps through 20 half-moves
 * at 200 ms intervals.
 *
 * What regression this catches:
 *   - SQLite query plan regression in master DB position lookup
 *   - Missing index on the position-stats table
 *   - Accidental full-table scan in `GetMasterPositionStats`
 *   - Go-side marshalling overhead on the Explorer results payload
 *
 * Thresholds are slightly relaxed on `max_ms` (60 ms vs the 50 ms default)
 * because a real IPC round-trip through Wails adds a small budget.
 */

// A 20-ply main-line Ruy Lopez — shares 10 half-moves with the fixture PGN
// (generate-perf-fixtures.ts), so the first moves have rich stats in the
// seeded master DB, which is the condition we want to measure.
const RUY_LOPEZ_PGN = [
  '[Event "Perf"]',
  '[Site "Perf"]',
  '[Date "2026.01.01"]',
  '[Round "1"]',
  '[White "Perf"]',
  '[Black "Perf"]',
  '[Result "*"]',
  '',
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6',
  '8. c3 O-O 9. h3 Nb8 10. d4 *',
].join('\n')

test.use({ perfFixture: { masterFixture: 'masterdb-small' } })

test('masterdb-query: step through 20 plies with Explorer open', async ({ wailsPage: page }) => {
  const scenario = 'masterdb-query'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results.jsonl')

  // Enable the Explorer panel — it's not in DEFAULT_LAYOUT, so we toggle it
  // on via the workspace toolbar button.
  await page.getByRole('button', { name: 'Show Explorer' }).click()

  // Switch the Explorer tab to Master DB (default is Master DB but be explicit
  // in case the default changes).
  await page.getByRole('button', { name: 'Master DB' }).click()

  // Load the Ruy Lopez PGN — this shares the first 10 plies with the fixture
  // games, so the position stats are non-empty at every visited FEN.
  await page.getByRole('button', { name: 'PGN' }).click()
  await page.getByRole('button', { name: 'Load Game...' }).click()
  await page.getByPlaceholder('Paste PGN here…').fill(RUY_LOPEZ_PGN)
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // Focus the board so ArrowRight advances the ply.
  await page.locator('cg-board').first().click({ position: { x: 5, y: 5 } })

  // Let the initial Explorer fetch settle before we start measuring.
  await page.waitForTimeout(300)

  await startFrameRecording(page)

  // 20 half-moves, 200 ms gap — each ply triggers two IPC round-trips
  // (GetMasterPositionStats + GetMasterGamesAtPosition) plus Explorer
  // re-render with fresh data.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
  }

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  // max_ms is the key threshold — if any single IPC round-trip stalls the
  // render thread past 60 ms, we want to know immediately.
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.05, maxFrameMs: 60 }, scenario)
})

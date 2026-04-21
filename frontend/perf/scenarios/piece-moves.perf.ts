import path from 'node:path'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Chessground piece-move animation smoothness. Loads a ~40-move PGN via the
 * PastePGNDialog (real IPC, real chessops parse), then steps through the
 * game one move at a time via ArrowRight.  Each step triggers a 150 ms
 * chessground animation plus notation re-render.
 *
 * Real-binary scenario — exercises chessground + chessops + AnalysisContext
 * + notation panel + any side-channel IPC triggered on ply change.
 */

const SCHOLARS_MATE_PGN = [
  '[Event "Perf"]',
  '[Site "Perf"]',
  '[Date "2026.01.01"]',
  '[Round "1"]',
  '[White "Perf"]',
  '[Black "Perf"]',
  '[Result "1-0"]',
  '',
  '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0',
].join('\n')

// A ~40-ply sample Ruy Lopez. Keeps the recording long enough that a single
// slow frame can't mask the signal.
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
  '8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8',
  '14. Ng3 g6 15. a4 c5 16. d5 c4 17. Bg5 h6 18. Be3 Nc5 19. Qd2 h5 20. Bg5 *',
].join('\n')

void SCHOLARS_MATE_PGN

test('piece-moves: arrow through Ruy Lopez (20 full moves)', async ({ wailsPage: page }) => {
  const scenario = 'piece-moves'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results.jsonl')

  // Load the PGN through the real UI — this exercises the actual ImportPGN code
  // path the user hits.
  await page.getByRole('button', { name: 'PGN' }).click()
  await page.getByRole('button', { name: 'Load Game...' }).click()
  await page.getByPlaceholder('Paste PGN here…').fill(RUY_LOPEZ_PGN)
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // Focus the board so ArrowRight is interpreted as "next move".
  await page.locator('cg-board').first().click({ position: { x: 5, y: 5 } })

  await startFrameRecording(page)

  // 40 half-moves, 200 ms gap — long enough that each 150 ms chessground
  // animation finishes before the next ArrowRight without dead-time jitter.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
  }

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.05, maxFrameMs: 50 }, scenario)
})

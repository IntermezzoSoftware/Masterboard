/**
 * Reports page E2E tests.
 *
 * Uses a custom installBridge override to inject realistic opponent data,
 * then navigates to /reports via the nav bar.
 */
import { test, expect, installBridge } from './fixtures'

const PLAYER_STATS = {
  totalGames: 45,
  asWhite: { wins: 20, draws: 10, losses: 5, total: 35 },
  asBlack: { wins: 8, draws: 5, losses: 5, total: 18 },
  byTimeControl: [],
  byOpening: [
    {
      eco: 'C65',
      opening: 'Ruy Lopez',
      games: 20,
      winPct: 60,
      drawPct: 25,
      lossPct: 15,
      asWhite: 15,
      asBlack: 5,
      whiteWins: 9,
      blackWins: 1,
      whiteLosses: 2,
      blackLosses: 3,
      whiteDraws: 4,
      blackDraws: 1,
    },
  ],
}

const ANALYSIS_STATS_EMPTY = {
  accuracyTimeSeries: [],
  blunderHeatmap: [],
  blunderPositions: [],
  luckStats: { blunderCount: 0, unpunishedBlunders: 0, luckRate: 0, oppBlunderCount: 0, exploitedBlunders: 0, opportunismRate: 0 },
}

async function gotoReportsPage(page: any) {
  await installBridge(page, undefined, {})
  await page.addInitScript(() => {
    const bridge = (window as any)?.go?.main?.App
    if (!bridge) return
    bridge.GetPlayerNames = async () => ['Magnus Carlsen', 'Magnus Christensen']
    bridge.GetPlayerStats = async () => ({
      totalGames: 45,
      asWhite: { wins: 20, draws: 10, losses: 5, total: 35 },
      asBlack: { wins: 8, draws: 5, losses: 5, total: 18 },
      byTimeControl: [],
      byOpening: [
        {
          eco: 'C65',
          opening: 'Ruy Lopez',
          games: 20,
          winPct: 60,
          drawPct: 25,
          lossPct: 15,
          asWhite: 15,
          asBlack: 5,
          whiteWins: 9,
          blackWins: 1,
          whiteLosses: 2,
          blackLosses: 3,
          whiteDraws: 4,
          blackDraws: 1,
        },
      ],
    })
    bridge.GetPlayerAnalysisStats = async () => ({
      accuracyTimeSeries: [],
      blunderHeatmap: [],
      blunderPositions: [],
      luckStats: { blunderCount: 0, unpunishedBlunders: 0, luckRate: 0, oppBlunderCount: 0, exploitedBlunders: 0, opportunismRate: 0 },
    })
    bridge.GetDeviationPositions = async () => []
    bridge.AnalyzeOpponentGames = async () => 3
    bridge.GetQueueStatus = async () => ({ remaining: 0, active: 0, queued: 0 })
    bridge.ExportOpponentReport = async () => '[Event "Test"]\n*'
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Reports' }).click()
  await page.getByTestId('page-reports').waitFor()
}

async function selectPlayer(page: any, name: string) {
  const input = page.getByPlaceholder('Search opponent name...')
  await input.fill('Magnus')
  // Wait for the autocomplete dropdown to appear
  await page.getByRole('option', { name }).waitFor()
  await page.getByRole('option', { name }).click()
  // Wait for data to load — "games in database" is rendered after stats resolve
  await page.getByText('games in database').waitFor()
}


test.describe('Reports page — navigation', () => {
  test('navigates to /reports and shows page', async ({ page }) => {
    await gotoReportsPage(page)
    await expect(page.getByTestId('page-reports')).toBeVisible()
  })

})


test.describe('Reports page — autocomplete', () => {
  test('typing in search box shows suggestions', async ({ page }) => {
    await gotoReportsPage(page)
    const input = page.getByPlaceholder('Search opponent name...')
    await input.fill('Magnus')
    await expect(page.getByRole('option', { name: 'Magnus Carlsen' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Magnus Christensen' })).toBeVisible()
  })

  test('clicking a suggestion selects the player', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    // Selected player chip appears
    await expect(page.getByText('Magnus Carlsen').first()).toBeVisible()
  })
})


test.describe('Reports page — metadata tier', () => {
  test('shows colour results section after player selected', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await expect(page.getByText('Results by colour')).toBeVisible()
  })

  test('shows at least one opening table row', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await expect(page.getByText('C65').first()).toBeVisible()
    await expect(page.getByText('Ruy Lopez').first()).toBeVisible()
  })
})


test.describe('Reports page — empty analysis state', () => {
  test('shows Analyse button when analysis stats are empty', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await expect(page.getByRole('button', { name: /Analyse.*games/i })).toBeVisible()
  })

  test('does not show blunder positions section when analysis stats are empty', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await expect(page.getByText('Blunder positions')).not.toBeVisible()
  })

  test('does not show luck section when analysis stats are empty', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await expect(page.getByText('Luck & opportunism')).not.toBeVisible()
  })
})


test.describe('Reports page — analyse button flow', () => {
  test('opens analysis modal when AnalyzeOpponentGames returns > 0', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await page.getByRole('button', { name: /Analyse.*games/i }).click()
    // Modal title references the player name
    await expect(page.getByText(/Analysing Magnus Carlsen/)).toBeVisible()
    // Queued count in the modal body
    await expect(page.getByText(/Queued 3 games? for analysis/)).toBeVisible()
  })

  test('modal can be closed', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await page.getByRole('button', { name: /Analyse.*games/i }).click()
    await page.getByText(/Analysing Magnus Carlsen/).waitFor()
    await page.getByRole('dialog').getByText('Close', { exact: true }).click()
    await expect(page.getByText(/Analysing Magnus Carlsen/)).not.toBeVisible()
  })
})


test.describe('Reports page — all analysed message', () => {
  test('shows inline message when AnalyzeOpponentGames returns 0', async ({ page }) => {
    await installBridge(page, undefined, {})
    await page.addInitScript(() => {
      const bridge = (window as any)?.go?.main?.App
      if (!bridge) return
      bridge.GetPlayerNames = async () => ['Magnus Carlsen']
      bridge.GetPlayerStats = async () => ({
        totalGames: 45,
        asWhite: { wins: 20, draws: 10, losses: 5, total: 35 },
        asBlack: { wins: 8, draws: 5, losses: 5, total: 18 },
        byTimeControl: [],
        byOpening: [
          {
            eco: 'C65',
            opening: 'Ruy Lopez',
            games: 20,
            winPct: 60,
            drawPct: 25,
            lossPct: 15,
            asWhite: 15,
            asBlack: 5,
            whiteWins: 9,
            blackWins: 1,
            whiteLosses: 2,
            blackLosses: 3,
            whiteDraws: 4,
            blackDraws: 1,
          },
        ],
      })
      bridge.GetPlayerAnalysisStats = async () => ({
        accuracyTimeSeries: [],
        blunderHeatmap: [],
        blunderPositions: [],
        luckStats: { blunderCount: 0, unpunishedBlunders: 0, luckRate: 0, oppBlunderCount: 0, exploitedBlunders: 0, opportunismRate: 0 },
      })
      bridge.GetDeviationPositions = async () => []
      // Override: all games already analysed
      bridge.AnalyzeOpponentGames = async () => 0
      bridge.GetQueueStatus = async () => ({ remaining: 0, active: 0, queued: 0 })
      bridge.ExportOpponentReport = async () => '[Event "Test"]\n*'
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Reports' }).click()
    await page.getByTestId('page-reports').waitFor()
    await selectPlayer(page, 'Magnus Carlsen')
    await page.getByRole('button', { name: /Analyse.*games/i }).click()
    await expect(page.getByText('All games already analysed.')).toBeVisible()
    // No modal should open
    await expect(page.getByText(/Analysing Magnus Carlsen/)).not.toBeVisible()
  })
})


test.describe('Reports page — export', () => {
  test('Export Report as PGN button is visible when player is selected', async ({ page }) => {
    await gotoReportsPage(page)
    await selectPlayer(page, 'Magnus Carlsen')
    await expect(page.getByRole('button', { name: 'Export Report as PGN' })).toBeVisible()
  })
})

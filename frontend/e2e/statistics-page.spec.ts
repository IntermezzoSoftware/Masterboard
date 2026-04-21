/**
 * Statistics page E2E tests.
 *
 * Uses a custom installBridge override to inject realistic stats data,
 * then navigates to /statistics via the nav bar.
 */
import { test, expect, installBridge } from './fixtures'

const STATS_DATA = {
  totalGames: 25,
  analyzedGames: 5,
  asWhite: { wins: 8, draws: 2, losses: 3, total: 13 },
  asBlack: { wins: 5, draws: 3, losses: 4, total: 12 },
  byTimeControl: [
    { category: 'rapid', results: { wins: 8, draws: 3, losses: 5, total: 16 } },
  ],
  byOpening: [
    {
      eco: 'C65',
      opening: 'Spanish Game',
      games: 8,
      winPct: 62.5,
      drawPct: 25,
      lossPct: 12.5,
      asWhite: 5,
      asBlack: 3,
    },
  ],
}

async function gotoStatisticsPage(page: any) {
  await installBridge(page, undefined, {})
  // Override GetPlayerStats and GetPlayerAnalysisStats with test data.
  await page.addInitScript((stats: object) => {
    const bridge = (window as any)?.go?.main?.App
    if (bridge) {
      bridge.GetPlayerStats = async () => stats
      bridge.GetPlayerAnalysisStats = async () => ({
        accuracyTimeSeries: [],
        blunderHeatmap: [],
        blunderPositions: [],
        luckStats: {
          blunderCount: 0,
          unpunishedBlunders: 0,
          luckRate: 0,
          oppBlunderCount: 0,
          exploitedBlunders: 0,
          opportunismRate: 0,
        },
      })
    }
  }, STATS_DATA)
  await page.goto('/')
  await page.getByRole('link', { name: 'Statistics' }).click()
  await page.getByRole('heading', { name: 'Statistics' }).waitFor()
}


test.describe('Statistics page — structure', () => {
  test('shows Statistics heading', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible()
  })

  test('shows overview cards once stats load', async ({ page }) => {
    await gotoStatisticsPage(page)
    // Overview card labels appear once stats resolve.
    await expect(page.getByText('Total').first()).toBeVisible()
  })

  test('shows Results by colour section', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText('Results by colour')).toBeVisible()
  })

  test('shows Results by time control section', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText('Results by time control')).toBeVisible()
  })

  test('shows Opening performance section', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText('Opening performance')).toBeVisible()
  })
})


test.describe('Statistics page — data', () => {
  test('shows Rapid row in time control table', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText('Rapid')).toBeVisible()
  })

  test('shows C65 ECO code in opening table', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText('C65')).toBeVisible()
  })

  test('shows Spanish Game opening name', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText('Spanish Game')).toBeVisible()
  })

  test('shows analysis gate for partially analyzed games', async ({ page }) => {
    await gotoStatisticsPage(page)
    await expect(page.getByText(/not yet analysed/)).toBeVisible()
  })
})

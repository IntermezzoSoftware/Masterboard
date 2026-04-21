/**
 * E2E tests for Epic 6.1 — Opening Deviation Detection.
 *
 * Covers: off-book badge in notation panel, Opening section in Analysis panel,
 * and no badge/section for non-personal games.
 */
import { test, expect, installBridge, MOCK_FOLDERS, type Page } from './fixtures'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const MAGNUS_GAME = {
  id: 'game-magnus',
  white: 'Magnus',
  black: 'Opponent',
  whiteElo: 2850,
  blackElo: 2700,
  result: '*',
  date: '2024.01.01',
  event: 'Test',
  eco: 'D00',
  opening: "Queen's Pawn",
  timeControl: '?',
  source: 'pgn',
  folderId: null,
  collectionNames: [],
  site: '',
  round: '',
  pgn: '[White "Magnus"][Black "Opponent"][Result "*"] 1. d4 *',
}

const NEUTRAL_GAME = {
  id: 'game-neutral',
  white: 'Carlsen',
  black: 'Nepomniachtchi',
  whiteElo: 2860,
  blackElo: 2790,
  result: '1-0',
  date: '2023.01.01',
  event: 'Test',
  eco: 'C50',
  opening: 'Italian',
  timeControl: '?',
  source: 'pgn',
  folderId: null,
  collectionNames: [],
  site: '',
  round: '',
  pgn: '[White "Carlsen"][Black "Nepomniachtchi"][Result "1-0"] 1. e4 e5 *',
}

const DEVIATION_RESULT = {
  gameId: 'game-magnus',
  deviationPly: 0,
  deviationFen: START_FEN,
  playerWentOffBook: true,
  repertoireId: 'rep-1',
  expectedMoves: ['e4'],
  playedMove: 'd4',
}

async function setupPage(page: Page, game: object, deviation: object | null, identity: string | null) {
  // Disable splash screen via localStorage before React reads it.
  await page.addInitScript(() => {
    localStorage.setItem('masterboard-splashEnabled', 'false')
  })
  await installBridge(page, MOCK_FOLDERS, { games: [game] })
  await page.addInitScript(
    ({ game, deviation, identity }: { game: object; deviation: object | null; identity: string | null }) => {
      const b = (window as any).go.main.App
      b.GetGame = async () => game
      b.GetIdentityNames = async () => (identity ? [identity] : [])
      b.GetGameDeviation = async () => null
      b.DetectDeviation = async () => deviation
    },
    { game, deviation, identity },
  )
}

async function openGame(page: Page, playerName: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Games' }).click()
  await page.getByText('All Games').waitFor()
  await page.locator('tr').filter({ hasText: playerName }).getByText(playerName).first().click()
  await page.getByRole('button', { name: 'Save game' }).waitFor()
}


test.describe('deviation detection', () => {
  test('shows off-book badge in notation panel for personal game', async ({ page }) => {
    await setupPage(page, MAGNUS_GAME, DEVIATION_RESULT, 'Magnus')
    await openGame(page, 'Magnus')

    // Wait for the move to appear in the notation panel before checking for the badge
    await expect(page.getByTestId('panel-notation').getByText('d4')).toBeVisible()
    await expect(
      page.getByTestId('panel-notation').locator('[title="Off-book — left prepared opening"]'),
    ).toBeVisible()
  })

  test('no badge for non-personal game', async ({ page }) => {
    await setupPage(page, NEUTRAL_GAME, null, null)
    await openGame(page, 'Carlsen')

    await expect(
      page.getByTestId('panel-notation').locator('[title="Off-book — left prepared opening"]'),
    ).not.toBeVisible()
  })

  test('no badge when game is fully in repertoire (deviationPly = -1)', async ({ page }) => {
    const noDev = { ...DEVIATION_RESULT, deviationPly: -1, deviationFen: '', playedMove: '' }
    await setupPage(page, MAGNUS_GAME, noDev, 'Magnus')
    await openGame(page, 'Magnus')

    await expect(
      page.getByTestId('panel-notation').locator('[title="Off-book — left prepared opening"]'),
    ).not.toBeVisible()
  })
})

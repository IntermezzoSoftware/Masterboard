/**
 * Home page E2E tests.
 *
 * Covers the workspace toolbar dropdowns, dialogs, panel toggles, panel close
 * buttons, drag-and-drop rearrangement, and engine analysis panel.
 */
import { test, expect } from './fixtures'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const FEN_AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'


async function loadPgn(page: import('@playwright/test').Page, pgn: string) {
  await page.getByRole('button', { name: 'PGN' }).click()
  await page.getByRole('button', { name: 'Load Game...' }).click()
  await page.getByPlaceholder('Paste PGN here…').fill(pgn)
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
}


test.describe('toolbar', () => {
  test('New, Save, FEN and PGN buttons are visible', async ({ boardPage: page }) => {
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save game' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FEN' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'PGN' })).toBeVisible()
  })

  test('default panel toggles are aria-pressed=true for Board, Notation and Engine', async ({ boardPage: page }) => {
    await expect(page.getByLabel('Hide Board')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Hide Notation')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Hide Engine')).toHaveAttribute('aria-pressed', 'true')
  })
})


test.describe('FEN dropdown', () => {
  test('clicking FEN opens dropdown with Copy FEN and Load Position…', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'FEN' }).click()
    await expect(page.getByRole('button', { name: 'Copy FEN' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load Position…' })).toBeVisible()
  })

  test('clicking outside closes the FEN dropdown', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'FEN' }).click()
    await expect(page.getByRole('button', { name: 'Copy FEN' })).toBeVisible()
    await page.getByTestId('panel-board').click()
    await expect(page.getByRole('button', { name: 'Copy FEN' })).not.toBeVisible()
  })

  test('clicking Load Position… opens the LoadFENDialog', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'FEN' }).click()
    await page.getByRole('button', { name: 'Load Position…' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Load position')).toBeVisible()
    await expect(page.getByPlaceholder('Paste FEN here…')).toBeVisible()
  })
})


test.describe('Load FEN dialog', () => {
  async function openFenDialog(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'FEN' }).click()
    await page.getByRole('button', { name: 'Load Position…' }).click()
    await page.getByPlaceholder('Paste FEN here…').waitFor()
  }

  test('Cancel closes the dialog', async ({ boardPage: page }) => {
    await openFenDialog(page)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('Load button is disabled when input is empty', async ({ boardPage: page }) => {
    await openFenDialog(page)
    await expect(page.getByRole('button', { name: 'Load' })).toBeDisabled()
  })

  test('pasting an invalid FEN shows an error', async ({ boardPage: page }) => {
    await openFenDialog(page)
    await page.getByPlaceholder('Paste FEN here…').fill('not a valid fen')
    await page.getByRole('button', { name: 'Load' }).click()
    await expect(page.getByText('Invalid FEN string.')).toBeVisible()
  })

  test('pasting a valid FEN closes the dialog', async ({ boardPage: page }) => {
    await openFenDialog(page)
    // Standard starting position FEN
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    await page.getByPlaceholder('Paste FEN here…').fill(startFen)
    await page.getByRole('button', { name: 'Load' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})


test.describe('PGN dropdown', () => {
  test('clicking PGN opens dropdown with Copy PGN and Load Game...', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'PGN' }).click()
    await expect(page.getByRole('button', { name: 'Copy PGN' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load Game...' })).toBeVisible()
  })

  test('clicking Load Game... opens the PastePGNDialog', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'PGN' }).click()
    await page.getByRole('button', { name: 'Load Game...' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Load PGN')).toBeVisible()
    await expect(page.getByPlaceholder('Paste PGN here…')).toBeVisible()
  })

  test('Cancel closes the PGN dialog', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'PGN' }).click()
    await page.getByRole('button', { name: 'Load Game...' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('Load button is disabled when PGN textarea is empty', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'PGN' }).click()
    await page.getByRole('button', { name: 'Load Game...' }).click()
    await expect(page.getByRole('button', { name: 'Load' })).toBeDisabled()
  })
})


test.describe('Save dialog', () => {
  test('clicking Save on an empty board opens SaveGameDialog', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'Save game' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Save Game')).toBeVisible()
  })

  test('SaveGameDialog has White, Black, Event, Date, Result fields', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'Save game' }).click()
    await expect(page.getByPlaceholder('White player')).toBeVisible()
    await expect(page.getByPlaceholder('Black player')).toBeVisible()
    await expect(page.getByPlaceholder('Tournament or event name')).toBeVisible()
    await expect(page.getByPlaceholder('YYYY.MM.DD')).toBeVisible()
  })

  test('Cancel closes the SaveGameDialog', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'Save game' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})


test.describe('Set Up Position dialog', () => {
  async function openPositionEditor(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByRole('button', { name: /set up position/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }

  test('shows Edit position dialog with a rendered chess board', async ({ boardPage: page }) => {
    await openPositionEditor(page)
    // cg-board is the element Chessground renders the board squares into.
    // It is only present (and has non-zero dimensions) when Chessground has
    // fully initialised inside the dialog portal.
    const cgBoard = page.locator('[data-testid="position-editor-board"] cg-board')
    await expect(cgBoard).toBeVisible()
    const box = await cgBoard.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)
  })

  test('shows Cancel and Load Position buttons', async ({ boardPage: page }) => {
    await openPositionEditor(page)
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load Position' })).toBeVisible()
  })

  test('Cancel closes the dialog', async ({ boardPage: page }) => {
    await openPositionEditor(page)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})


test.describe('New game', () => {
  test('clicking New Game on an empty board resets without confirmation', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByRole('button', { name: 'New Game' }).click()
    // No confirmation dialog — still on board page
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Save game' })).toBeVisible()
  })

  test('clicking New Game after loading a PGN shows unsaved changes dialog', async ({ boardPage: page }) => {
    // Load a PGN with moves
    await page.getByRole('button', { name: 'PGN' }).click()
    await page.getByRole('button', { name: 'Load Game...' }).click()
    await page.getByPlaceholder('Paste PGN here…').fill('1. e4 e5 *')
    await page.getByRole('button', { name: 'Load' }).click()
    // Now click New > New Game — game is dirty
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByRole('button', { name: 'New Game' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Unsaved changes')).toBeVisible()
  })

  test('Discard in unsaved changes dialog resets the game', async ({ boardPage: page }) => {
    await page.getByRole('button', { name: 'PGN' }).click()
    await page.getByRole('button', { name: 'Load Game...' }).click()
    await page.getByPlaceholder('Paste PGN here…').fill('1. e4 e5 *')
    await page.getByRole('button', { name: 'Load' }).click()
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByRole('button', { name: 'New Game' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})


test.describe('panel toggles', () => {
  test('clicking an active toggle hides the panel', async ({ boardPage: page }) => {
    // With 3 panels the Notation toggle can be clicked
    await page.getByLabel('Hide Notation').click()
    await expect(page.getByLabel('Show Notation')).toHaveAttribute('aria-pressed', 'false')
    // Panel header should be gone
    await expect(page.getByTestId('panel-notation')).not.toBeVisible()
  })

  test('clicking an inactive toggle re-adds the panel', async ({ boardPage: page }) => {
    await page.getByLabel('Hide Notation').click()
    await expect(page.getByTestId('panel-notation')).not.toBeVisible()
    await page.getByLabel('Show Notation').click()
    await expect(page.getByTestId('panel-notation')).toBeVisible()
    await expect(page.getByLabel('Hide Notation')).toHaveAttribute('aria-pressed', 'true')
  })

  test('the last remaining panel toggle is disabled', async ({ boardPage: page }) => {
    // Remove until only Board remains
    await page.getByLabel('Hide Notation').click()
    await page.getByLabel('Hide Engine').click()
    // Now only Board is left — its toggle should be disabled
    await expect(page.getByLabel('Hide Board')).toBeDisabled()
  })
})


test.describe('panel close button', () => {
  test('clicking Close Notation removes the Notation panel', async ({ boardPage: page }) => {
    await page.getByLabel('Close Notation').click()
    await expect(page.getByTestId('panel-notation')).not.toBeVisible()
  })

  test('after closing Notation, toolbar toggle shows aria-pressed=false', async ({ boardPage: page }) => {
    await page.getByLabel('Close Notation').click()
    await expect(page.getByLabel('Show Notation')).toHaveAttribute('aria-pressed', 'false')
  })

  test('re-adding Notation via toolbar brings the panel back', async ({ boardPage: page }) => {
    await page.getByLabel('Close Notation').click()
    await page.getByLabel('Show Notation').click()
    await expect(page.getByTestId('panel-notation')).toBeVisible()
  })
})



test.describe('games panel', () => {
  test('Games panel toggle is aria-pressed=false by default', async ({ boardPage: page }) => {
    await expect(page.getByLabel('Show Games')).toHaveAttribute('aria-pressed', 'false')
  })

  test('clicking Show Games adds the Games panel to the workspace', async ({ boardPage: page }) => {
    await page.getByLabel('Show Games').click()
    await expect(page.getByTestId('panel-games')).toBeVisible()
    await expect(page.getByLabel('Hide Games')).toHaveAttribute('aria-pressed', 'true')
  })

  test('clicking Hide Games removes the Games panel', async ({ boardPage: page }) => {
    await page.getByLabel('Show Games').click()
    await expect(page.getByTestId('panel-games')).toBeVisible()
    await page.getByLabel('Hide Games').click()
    await expect(page.getByTestId('panel-games')).not.toBeVisible()
    await expect(page.getByLabel('Show Games')).toHaveAttribute('aria-pressed', 'false')
  })
})


test.describe('PGN load button', () => {
  async function openPgnDialog(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'PGN' }).click()
    await page.getByRole('button', { name: 'Load Game...' }).click()
    await page.getByPlaceholder('Paste PGN here…').waitFor()
  }

  test('Load button becomes enabled when PGN text is pasted', async ({ boardPage: page }) => {
    await openPgnDialog(page)
    await page.getByPlaceholder('Paste PGN here…').fill('1. e4 e5 *')
    await expect(page.getByRole('button', { name: 'Load' })).toBeEnabled()
  })

  test('clicking Load with valid PGN closes the dialog', async ({ boardPage: page }) => {
    await openPgnDialog(page)
    await page.getByPlaceholder('Paste PGN here…').fill('1. e4 e5 *')
    await page.getByRole('button', { name: 'Load' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})

test.describe('panel drag-and-drop', () => {
  test('dragging Notation to left side of Board keeps all panels visible', async ({ boardPage: page }) => {
    const notationHandle = page.getByTestId('panel-notation').getByLabel('Drag to rearrange')
    const boardPanel = page.getByTestId('panel-board')
    const box = await boardPanel.boundingBox()
    expect(box).not.toBeNull()

    // Drag to left drop zone (first 25% of board panel width)
    await notationHandle.dragTo(boardPanel, {
      targetPosition: { x: Math.floor(box!.width * 0.1), y: Math.floor(box!.height / 2) },
    })

    // All panels should remain in the DOM
    await expect(page.getByTestId('panel-board')).toBeVisible()
    await expect(page.getByTestId('panel-notation')).toBeVisible()
    await expect(page.getByTestId('panel-engine')).toBeVisible()
  })

  test('dragging Engine to top of Board keeps all panels visible', async ({ boardPage: page }) => {
    const engineHandle = page.getByTestId('panel-engine').getByLabel('Drag to rearrange')
    const boardPanel = page.getByTestId('panel-board')
    const box = await boardPanel.boundingBox()
    expect(box).not.toBeNull()

    // Drag to top drop zone (first 25% of board panel height)
    await engineHandle.dragTo(boardPanel, {
      targetPosition: { x: Math.floor(box!.width / 2), y: Math.floor(box!.height * 0.1) },
    })

    await expect(page.getByTestId('panel-board')).toBeVisible()
    await expect(page.getByTestId('panel-notation')).toBeVisible()
    await expect(page.getByTestId('panel-engine')).toBeVisible()
  })

  test('after any drag, all panel toolbar toggles remain aria-pressed=true', async ({ boardPage: page }) => {
    const notationHandle = page.getByTestId('panel-notation').getByLabel('Drag to rearrange')
    const boardPanel = page.getByTestId('panel-board')
    const box = await boardPanel.boundingBox()
    expect(box).not.toBeNull()

    await notationHandle.dragTo(boardPanel, {
      targetPosition: { x: Math.floor(box!.width * 0.1), y: Math.floor(box!.height / 2) },
    })

    await expect(page.getByLabel('Hide Board')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Hide Notation')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Hide Engine')).toHaveAttribute('aria-pressed', 'true')
  })
})


test.describe('engine analysis', () => {
  test('1: engine panel is present', async ({ boardPageWithEngine: page }) => {
    await expect(page.getByTestId('panel-engine')).toBeVisible()
  })

  test('2: Start analysis — StartAnalysis called with starting position FEN', async ({ boardPageWithEngine: page }) => {
    await expect(page.getByTestId('engine-start-btn')).not.toBeDisabled()
    await page.getByTestId('engine-start-btn').click()
    const calls = await page.evaluate(() => (window as any)._engineCalls ?? [])
    expect(calls[0]).toMatchObject({ method: 'StartAnalysis', fen: INITIAL_FEN, multiPV: 1 })
  })

  test('3: Score appears after start', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    await expect(page.getByTestId('engine-score')).not.toBeEmpty({ timeout: 2000 })
  })

  test('4: Depth 20 shown after events processed', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    await expect(page.getByTestId('engine-depth')).toHaveText('20', { timeout: 2000 })
  })

  test('5: PV row shows SAN notation after start', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    // depth-3+ PV includes Nf3; UCI would show "g1f3" instead
    await expect(page.getByTestId('engine-pv-0')).toContainText('Nf3', { timeout: 2000 })
  })

  test('6: Analysis restarts when position changes via Load Position', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    // Wait for first analysis to register
    await page.waitForFunction(() =>
      ((window as any)._engineCalls ?? []).filter((c: any) => c.method === 'StartAnalysis').length >= 1
    )
    // Change position via FEN dialog
    await page.getByRole('button', { name: 'FEN' }).click()
    await page.getByRole('button', { name: 'Load Position…' }).click()
    await page.getByPlaceholder('Paste FEN here…').fill(FEN_AFTER_E4)
    await page.getByRole('button', { name: 'Load' }).click()
    // Wait for a second StartAnalysis call with the new FEN
    await page.waitForFunction((fen: string) => {
      const calls = (window as any)._engineCalls ?? []
      return calls.filter((c: any) => c.method === 'StartAnalysis' && c.fen === fen).length >= 1
    }, FEN_AFTER_E4, { timeout: 3000 })
    const calls = await page.evaluate(() => (window as any)._engineCalls ?? [])
    const startCalls = calls.filter((c: any) => c.method === 'StartAnalysis')
    expect(startCalls.length).toBeGreaterThanOrEqual(2)
    expect(startCalls[startCalls.length - 1].fen).toBe(FEN_AFTER_E4)
  })

  test('7: Stop analysis — StopAnalysis called, placeholder restored', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    await expect(page.getByTestId('engine-score')).not.toBeEmpty({ timeout: 2000 })
    await page.getByTestId('engine-stop-btn').click()
    const calls = await page.evaluate(() => (window as any)._engineCalls ?? [])
    expect(calls.some((c: any) => c.method === 'StopAnalysis')).toBe(true)
    await expect(page.getByText('Press Start to start engine')).toBeVisible()
  })
})


test('Explorer panel shows Repertoire tab with empty state', async ({ boardPage: page }) => {
  // Open the Explorer panel via the toolbar toggle
  await page.getByLabel('Show Explorer').click()
  await expect(page.getByTestId('repertoire-database')).toBeVisible()

  await page.getByRole('button', { name: 'Repertoire' }).click()
  await expect(page.getByText(/this position is not in any of your repertoires/i)).toBeVisible()
})

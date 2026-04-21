/**
 * Game import E2E tests.
 *
 * Covers the ImportMenu dropdown, ImportPlatformDialog (Lichess and Chess.com),
 * and the quick-sync shortcut buttons.
 */
import { test, expect } from './fixtures'


test.describe('import menu', () => {
  test('clicking Import opens the dropdown with four options', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await expect(page.getByRole('menuitem', { name: 'PGN file…' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'PGN folder…' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'From Lichess…' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'From Chess.com…' })).toBeVisible()
  })

  test('clicking outside the dropdown closes it', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await expect(page.getByRole('menuitem', { name: 'PGN file…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'PGN file…' })).not.toBeVisible()
  })
})


test.describe('Lichess dialog - configure step', () => {
  test('clicking From Lichess… opens the dialog', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Lichess…' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Import from Lichess')).toBeVisible()
  })

  test('dialog shows username, date, time control and max games fields', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Lichess…' }).click()
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('From date')).toBeVisible()
    await expect(page.getByLabel('To date')).toBeVisible()
    await expect(page.getByLabel('Time control')).toBeVisible()
    await expect(page.getByLabel('Max games')).toBeVisible()
  })

  test('clicking Cancel closes the dialog', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Lichess…' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('clicking Preview with empty username shows an error', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Lichess…' }).click()
    await page.getByLabel('Username').clear()
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByText('Username is required')).toBeVisible()
  })

  test('entering a username and clicking Preview transitions to preview step', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Lichess…' }).click()
    await page.getByLabel('Username').fill('testuser')
    await page.getByRole('button', { name: 'Preview' }).click()
    // Preview step shows the game count in the title
    await expect(page.getByText(/1 game fetched/)).toBeVisible()
  })
})


test.describe('Lichess dialog - preview step', () => {
  async function openPreview(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Lichess…' }).click()
    await page.getByLabel('Username').fill('testuser')
    await page.getByRole('button', { name: 'Preview' }).click()
    await page.getByText(/1 game fetched/).waitFor()
  }

  test('shows the preview game in the table', async ({ gamesImportPage: page }) => {
    await openPreview(page)
    await expect(page.getByText('Alice')).toBeVisible()
    await expect(page.getByText('Bob')).toBeVisible()
  })

  test('shows selected count', async ({ gamesImportPage: page }) => {
    await openPreview(page)
    await expect(page.getByText('1 of 1 selected')).toBeVisible()
  })

  test('clicking Back returns to configure step', async ({ gamesImportPage: page }) => {
    await openPreview(page)
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByLabel('Username')).toBeVisible()
  })

  test('unchecking all games disables the Import button', async ({ gamesImportPage: page }) => {
    await openPreview(page)
    // Uncheck select-all
    await page.getByRole('columnheader').getByRole('checkbox').click()
    await expect(page.getByRole('button', { name: /Import/ })).toBeDisabled()
  })

  test('clicking Import imports selected games and shows notice', async ({ gamesImportPage: page }) => {
    await openPreview(page)
    await page.getByRole('button', { name: 'Import 1' }).click()
    // Dialog should close and notice should appear
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('status')).toContainText('Imported 1 new game')
  })
})


test.describe('Chess.com dialog', () => {
  test('clicking From Chess.com… opens the dialog with correct title', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Chess.com…' }).click()
    await expect(page.getByText('Import from Chess.com')).toBeVisible()
  })

  test('Chess.com dialog has the same form fields as Lichess', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('menuitem', { name: 'From Chess.com…' }).click()
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Max games')).toBeVisible()
  })
})


test.describe('quick-sync', () => {
  test('Lichess quick-sync button is visible when username is saved', async ({ gamesImportPage: page }) => {
    // gamesImportPage fixture sets lichess.username = 'testuser'
    await expect(page.getByRole('button', { name: /Lichess/i })).toBeVisible()
  })

  test('clicking the Lichess quick-sync button opens the import dialog in preview step', async ({ gamesImportPage: page }) => {
    await page.getByRole('button', { name: /Lichess/i }).click()
    // autoFetch=true triggers immediate fetch → preview step appears
    await expect(page.getByText(/game.* fetched/)).toBeVisible()
  })
})

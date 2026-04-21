/**
 * Settings page E2E tests.
 *
 * Covers account username inputs, theme toggle, and the Master Game Database section.
 */
import { test, expect } from './fixtures'


test.describe('page structure', () => {
  test('shows Settings heading', async ({ settingsPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('shows Connected Accounts section', async ({ settingsPage: page }) => {
    await expect(page.getByText('Connected Accounts')).toBeVisible()
  })

  test('shows Lichess username input', async ({ settingsPage: page }) => {
    await expect(page.getByLabel('Lichess username')).toBeVisible()
  })

  test('shows Chess.com username input', async ({ settingsPage: page }) => {
    await expect(page.getByLabel('Chess.com username')).toBeVisible()
  })

  test('shows auto-save helper text', async ({ settingsPage: page }) => {
    await expect(page.getByText(/saved automatically/i)).toBeVisible()
  })
})


test.describe('player profile', () => {
  test('shows Player Profile section', async ({ settingsPage: page }) => {
    await expect(page.getByText('Player Profile')).toBeVisible()
  })

  test('shows Your name input', async ({ settingsPage: page }) => {
    await expect(page.getByLabel('Your name')).toBeVisible()
  })

  test('Your name input accepts typing', async ({ settingsPage: page }) => {
    await page.getByLabel('Your name').fill('Carlsen, Magnus')
    await expect(page.getByLabel('Your name')).toHaveValue('Carlsen, Magnus')
  })

  test('Your name is saved on blur and persists when navigating away and back', async ({ settingsPage: page }) => {
    await page.getByLabel('Your name').fill('Carlsen, Magnus')
    await page.getByLabel('Your name').blur()
    await page.getByRole('link', { name: 'Home' }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByText('Player Profile').waitFor()
    await expect(page.getByLabel('Your name')).toHaveValue('Carlsen, Magnus')
  })

  test('Add variant button adds a second input row', async ({ settingsPage: page }) => {
    await page.getByLabel('Your name', { exact: true }).fill('Carlsen, Magnus')
    await page.getByLabel('Your name', { exact: true }).blur()
    await page.getByRole('button', { name: /add variant/i }).click()
    await expect(page.getByLabel('Your name variant 2')).toBeVisible()
  })

  test('second variant persists when navigating away and back', async ({ settingsPage: page }) => {
    await page.getByLabel('Your name').fill('Carlsen, Magnus')
    await page.getByLabel('Your name').blur()
    await page.getByRole('button', { name: /add variant/i }).click()
    await page.getByLabel('Your name variant 2').fill('Magnus Carlsen')
    await page.getByLabel('Your name variant 2').blur()
    await page.getByRole('link', { name: 'Home' }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByText('Player Profile').waitFor()
    await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Carlsen, Magnus')
    await expect(page.getByLabel('Your name variant 2')).toHaveValue('Magnus Carlsen')
  })
})


test.describe('username inputs', () => {
  test('Lichess username input accepts typing', async ({ settingsPage: page }) => {
    await page.getByLabel('Lichess username').fill('DrNykterstein')
    await expect(page.getByLabel('Lichess username')).toHaveValue('DrNykterstein')
  })

  test('Chess.com username input accepts typing', async ({ settingsPage: page }) => {
    await page.getByLabel('Chess.com username').fill('MagnusCarlsen')
    await expect(page.getByLabel('Chess.com username')).toHaveValue('MagnusCarlsen')
  })

  test('Lichess username is saved on blur (persists when navigating away and back)', async ({ settingsPage: page }) => {
    await page.getByLabel('Lichess username').fill('MyLichessUser')
    await page.getByLabel('Lichess username').blur()
    // Navigate away and come back
    await page.getByRole('link', { name: 'Home' }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByText('Connected Accounts').waitFor()
    // The bridge mock stores the value in _settings, GetSetting returns it
    await expect(page.getByLabel('Lichess username')).toHaveValue('MyLichessUser')
  })
})


test.describe('master game database', () => {
  test('shows Master Game Database section', async ({ settingsPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Master Game Database' })).toBeVisible()
  })

  test('shows link to Lumbra\'s Gigabase', async ({ settingsPage: page }) => {
    await expect(page.getByRole('link', { name: /lumbra/i })).toBeVisible()
  })

  test('shows "Select PGN Files" button in not-configured state', async ({ settingsPage: page }) => {
    await expect(page.getByRole('button', { name: /select pgn files/i })).toBeVisible()
  })
})


test.describe('board appearance', () => {
  test('shows Board Appearance section', async ({ settingsPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Board Appearance' })).toBeVisible()
  })

  test('shows all four board theme swatches', async ({ settingsPage: page }) => {
    await expect(page.getByTestId('board-theme-brown')).toBeVisible()
    await expect(page.getByTestId('board-theme-blue')).toBeVisible()
    await expect(page.getByTestId('board-theme-green')).toBeVisible()
    await expect(page.getByTestId('board-theme-purple')).toBeVisible()
  })

  test('brown swatch is checked by default', async ({ settingsPage: page }) => {
    await expect(page.getByTestId('board-theme-brown')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('board-theme-blue')).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking a swatch marks it as checked', async ({ settingsPage: page }) => {
    await page.getByTestId('board-theme-blue').click()
    await expect(page.getByTestId('board-theme-blue')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('board-theme-brown')).toHaveAttribute('aria-checked', 'false')
  })
})


test.describe('engine configuration', () => {
  test('shows Engine Configuration section', async ({ settingsPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Engine Configuration' })).toBeVisible()
  })

  test('shows Add engine button', async ({ settingsPage: page }) => {
    await expect(page.getByTestId('engine-add-btn')).toBeVisible()
  })

  test('does not show Remove button when no custom engine configured', async ({ settingsPage: page }) => {
    await page.getByRole('heading', { name: 'Engine Configuration' }).waitFor()
    await expect(page.getByTestId('engine-remove-0')).not.toBeVisible()
  })
})


test.describe('theme toggle', () => {
  test('theme toggle button is visible in the sidebar', async ({ settingsPage: page }) => {
    // The toggle shows "Dark mode" when in light mode (default) or "Light mode" in dark mode
    const toggle = page.getByRole('button', { name: /dark mode|light mode/i })
    await expect(toggle).toBeVisible()
  })

  test('clicking theme toggle switches between light and dark mode', async ({ settingsPage: page }) => {
    // App starts in light mode (default) — toggle switches to dark
    await page.getByRole('button', { name: 'Dark mode' }).click()
    const htmlClass = await page.locator('html').getAttribute('class')
    expect(htmlClass).toContain('dark')
  })

  test('clicking theme toggle again switches back to light mode', async ({ settingsPage: page }) => {
    await page.getByRole('button', { name: 'Dark mode' }).click()
    await page.getByRole('button', { name: 'Light mode' }).click()
    const htmlClass = await page.locator('html').getAttribute('class')
    expect(htmlClass ?? '').not.toContain('dark')
  })
})

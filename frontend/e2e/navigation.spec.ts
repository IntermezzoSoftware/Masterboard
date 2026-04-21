/**
 * Navigation E2E tests.
 *
 * Verifies that the sidebar nav links route to the correct pages and that
 * the active link is styled/marked correctly.
 */
import { test, expect } from './fixtures'

test.describe('default route', () => {
  test('loads BoardPage on initial visit', async ({ boardPage: page }) => {
    // The workspace toolbar is the distinctive marker of BoardPage
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Save/ })).toBeVisible()
  })
})

test.describe('sidebar navigation', () => {
  test('clicking Games link navigates to GamesPage', async ({ boardPage: page }) => {
    await page.getByRole('link', { name: 'Games' }).click()
    await expect(page.getByText('All Games')).toBeVisible()
    await expect(page.getByTestId('panel-board')).not.toBeVisible()
  })

  test('clicking Settings link navigates to SettingsPage', async ({ boardPage: page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByText('Connected Accounts')).toBeVisible()
  })

  test('clicking Openings link navigates to OpeningsPage', async ({ boardPage: page }) => {
    await page.getByRole('link', { name: 'Openings' }).click()
    await expect(page.getByRole('heading', { name: 'Openings' })).toBeVisible()
  })

  test('clicking Home from Games page returns to BoardPage', async ({ boardPage: page }) => {
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
  })
})

test.describe('active nav link', () => {
  test('Home link is active on BoardPage', async ({ boardPage: page }) => {
    await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  test('Games link becomes active after navigating to GamesPage', async ({ boardPage: page }) => {
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await expect(page.getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('Settings link becomes active on SettingsPage', async ({ boardPage: page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByText('Connected Accounts').waitFor()
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })
})

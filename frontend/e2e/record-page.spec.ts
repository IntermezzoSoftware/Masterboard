/**
 * Record page E2E tests.
 *
 * Covers the RecordPage layout, player form, navigation, and the save flow.
 */
import { test, expect } from './fixtures'


test.describe('page structure', () => {
  test('shows Record game header', async ({ recordPage: page }) => {
    await expect(page.getByText('Record game')).toBeVisible()
  })

  test('shows White and Black player inputs', async ({ recordPage: page }) => {
    await expect(page.getByPlaceholder('White player')).toBeVisible()
    await expect(page.getByPlaceholder('Black player')).toBeVisible()
  })

  test('shows Event input', async ({ recordPage: page }) => {
    await expect(page.getByPlaceholder('Tournament or event')).toBeVisible()
  })

  test('shows Date input', async ({ recordPage: page }) => {
    await expect(page.getByPlaceholder('YYYY.MM.DD')).toBeVisible()
  })

  test('shows Result selector', async ({ recordPage: page }) => {
    // The select element starts with the default value '*'
    await expect(page.getByRole('combobox').first()).toHaveValue('*')
  })

  test('shows board navigation controls', async ({ recordPage: page }) => {
    await expect(page.getByLabel('Go to start')).toBeVisible()
    await expect(page.getByLabel('Previous move')).toBeVisible()
    await expect(page.getByLabel('Next move')).toBeVisible()
    await expect(page.getByLabel('Go to end')).toBeVisible()
    await expect(page.getByLabel('Flip board')).toBeVisible()
  })

  test('shows New game and Finish & save buttons', async ({ recordPage: page }) => {
    await expect(page.getByRole('button', { name: 'New game' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Finish & save' })).toBeVisible()
  })
})


test.describe('navigation', () => {
  test('clicking ← Back to Games navigates to GamesPage', async ({ recordPage: page }) => {
    await page.getByRole('button', { name: '← Back to Games' }).click()
    await expect(page.getByText('All Games')).toBeVisible()
  })
})


test.describe('new game', () => {
  test('clicking New game clears the player fields', async ({ recordPage: page }) => {
    await page.getByPlaceholder('White player').fill('Alice')
    await page.getByPlaceholder('Black player').fill('Bob')
    await page.getByRole('button', { name: 'New game' }).click()
    await expect(page.getByPlaceholder('White player')).toHaveValue('')
    await expect(page.getByPlaceholder('Black player')).toHaveValue('')
  })
})


test.describe('save flow', () => {
  test('Finish & save saves directly without a dialog', async ({ recordPage: page }) => {
    await page.getByRole('button', { name: 'Finish & save' }).click()
    // Should navigate to GamesPage directly — no dialog appears
    await expect(page.getByText('All Games')).toBeVisible()
  })

  test('entered player names are used in the save', async ({ recordPage: page }) => {
    await page.getByPlaceholder('White player').fill('Alice')
    await page.getByPlaceholder('Black player').fill('Bob')
    await page.getByRole('button', { name: 'Finish & save' }).click()
    await expect(page.getByText('All Games')).toBeVisible()
  })
})

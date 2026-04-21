/**
 * Lichess Studies Import E2E tests.
 *
 * Covers the ImportStudyDialog on the Openings page: opening the dialog,
 * the configure → preview flow, and the private study error path.
 */
import { test, expect, installBridge, MOCK_FOLDERS } from './fixtures'

// Disable the splash screen so it doesn't block interactions.
async function disableSplash(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('masterboard-splashEnabled', 'false')
  })
}

// Helper: navigate to the Openings page with IPC mocks applied.
// fetchMeta: async function source string (serialisable to pass into browser)
async function gotoOpenings(
  page: import('@playwright/test').Page,
  fetchMetaImpl: string,
) {
  await disableSplash(page)
  await installBridge(page, MOCK_FOLDERS, { repertoires: [] })
  // Patch the bridge after installBridge sets up window.go.main.App
  await page.addInitScript((src: string) => {
    // eslint-disable-next-line no-eval
    const fetchMeta = eval('(' + src + ')')
    const waitAndPatch = () => {
      const app = (window as any)?.go?.main?.App
      if (app) {
        app.FetchLichessStudyMeta = fetchMeta
        app.ImportLichessStudy = async () => ({ chaptersImported: 2, movesImported: 42, gamesImported: 0, duplicates: 0 })
        app.LichessOAuthStatus = async () => ''
      }
    }
    // Scripts run in order, so go.main.App should already exist when this fires
    waitAndPatch()
  }, fetchMetaImpl)
  await page.goto('/')
  await page.getByRole('link', { name: 'Openings' }).click()
  // Wait for the page layout to stabilise
  await page.getByText('No repertoires yet.').waitFor()
}

const fetchMetaSuccess = `async (studyId) => ({
  id: 'abc12345',
  name: 'My Test Study',
  chapters: [
    { id: 'ch1id123', name: 'Chapter One', orientation: 'white' },
    { id: 'ch2id456', name: 'Chapter Two', orientation: 'black' },
  ],
  private: false,
})`

const fetchMetaPrivate = `async (studyId) => { throw new Error('study is private') }`

test.describe('Lichess Studies Import', () => {
  test('opens import dialog from Openings page', async ({ page }) => {
    await gotoOpenings(page, fetchMetaSuccess)
    await page.getByRole('button', { name: 'Import Study' }).click()
    await expect(page.getByText('Import Lichess Study')).toBeVisible()
  })

  test('configure → preview flow', async ({ page }) => {
    await gotoOpenings(page, fetchMetaSuccess)
    await page.getByRole('button', { name: 'Import Study' }).click()
    await page.getByPlaceholder(/lichess\.org\/study/).fill('https://lichess.org/study/abc12345')
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByText('My Test Study')).toBeVisible()
    await expect(page.getByText('Chapter One')).toBeVisible()
    await expect(page.getByText('Chapter Two')).toBeVisible()
  })

  test('shows private study error', async ({ page }) => {
    await gotoOpenings(page, fetchMetaPrivate)
    await page.getByRole('button', { name: 'Import Study' }).click()
    await page.getByPlaceholder(/lichess\.org\/study/).fill('priv1234')
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByText(/private/i)).toBeVisible()
    // The error message should contain a link/reference to Settings for OAuth
    await expect(page.getByText(/private.*Connect|Connect.*Lichess/i)).toBeVisible()
  })
})

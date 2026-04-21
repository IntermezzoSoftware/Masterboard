import { test as base, type Page } from '@playwright/test'
import { installBridge, MOCK_FOLDERS } from '../e2e/fixtures'

/**
 * Fixtures for the Vite-preview perf fallback path. Reuses the same in-page
 * IPC mock as the E2E suite (`installBridge`) so pure-frontend scenarios
 * (dialog transitions, panel drag, folder tree, theme toggle) can be measured
 * without building the real Wails binary.
 *
 * For the primary real-binary path, use `test-fixtures.ts` instead.
 */

interface PerfFeFixtures {
  /** Home page at `/` with an empty mock bridge. */
  bridgedPage: Page
}

export const test = base.extend<PerfFeFixtures>({
  bridgedPage: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, {})
    await page.goto('/')
    // Wait for the app shell to mount — the top-level nav link is a stable marker
    await page.getByRole('link', { name: 'Home' }).waitFor()
    await use(page)
  },
})

export { expect } from '@playwright/test'
export type { Page }

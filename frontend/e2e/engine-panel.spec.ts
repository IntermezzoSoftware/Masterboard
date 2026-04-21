/**
 * Engine panel E2E tests — Steps 14–17 features.
 *
 * Covers: MultiPV selector, PV-click board navigation, settings row,
 * eval bar visibility, and arrow toggle button.
 *
 * Basic start/stop coverage lives in board-page.spec.ts (tests 2–7) and is
 * not duplicated here.
 */
import { test, expect } from './fixtures'


test.describe('MultiPV selector', () => {
  test('Lines-1 button is active by default', async ({ boardPageWithEngine: page }) => {
    await expect(page.getByTestId('engine-multipv-btn-1')).toHaveClass(/bg-\[var\(--color-accent\)\]/)
  })

  test('clicking Lines-2 calls StartAnalysis with multiPV:2 and shows two PV rows', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    await expect(page.getByTestId('engine-score')).not.toBeEmpty({ timeout: 2000 })

    // Switch to 2 lines
    await page.getByTestId('engine-multipv-btn-2').click()

    // Manually emit two-line events so the panel can render two rows
    await page.evaluate(() => {
      const e1 = { depth: 5, selDepth: 7, multiPV: 1, scoreCp: 25, isMate: false, scoreMate: 0, nodes: 3200, timeMs: 3, pvUci: ['e2e4', 'e7e5'] }
      const e2 = { depth: 5, selDepth: 7, multiPV: 2, scoreCp: 10, isMate: false, scoreMate: 0, nodes: 3200, timeMs: 3, pvUci: ['d2d4', 'd7d5'] }
      ;(window as any).runtime.EventsEmit('engine:info', e1)
      ;(window as any).runtime.EventsEmit('engine:info', e2)
    })

    await expect(page.getByTestId('engine-pv-0')).toBeVisible({ timeout: 2000 })
    await expect(page.getByTestId('engine-pv-1')).toBeVisible({ timeout: 2000 })

    const calls = await page.evaluate(() => (window as any)._engineCalls ?? [])
    const startCalls = calls.filter((c: any) => c.method === 'StartAnalysis')
    expect(startCalls.some((c: any) => c.multiPV === 2)).toBe(true)
  })
})


test.describe('PV line click', () => {
  test('clicking PV text appends moves to notation panel', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    // Wait for PV to populate with depth-3+ output that includes Nf3
    await expect(page.getByTestId('engine-pv-0')).toContainText('Nf3', { timeout: 2000 })

    await page.getByTestId('engine-pv-text-0').click()

    // After clicking the PV, the notation panel should contain the first engine move (e4)
    const notation = page.getByTestId('panel-notation')
    await expect(notation).toContainText('e4', { timeout: 2000 })
  })
})


test.describe('settings row', () => {
  test('settings row is hidden by default and shown after clicking gear button', async ({ boardPageWithEngine: page }) => {
    await expect(page.getByTestId('engine-hash-input')).not.toBeVisible()
    await page.getByTestId('engine-settings-btn').click()
    await expect(page.getByTestId('engine-hash-input')).toBeVisible()
    await expect(page.getByTestId('engine-threads-input')).toBeVisible()
  })

  test('clicking gear again hides settings row', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-settings-btn').click()
    await expect(page.getByTestId('engine-hash-input')).toBeVisible()
    await page.getByTestId('engine-settings-btn').click()
    await expect(page.getByTestId('engine-hash-input')).not.toBeVisible()
  })
})


test.describe('eval bar', () => {
  test('eval bar is present in the DOM before analysis', async ({ boardPageWithEngine: page }) => {
    // The bar exists in the DOM but is invisible until analysis produces a score
    await expect(page.getByTestId('engine-eval-bar')).toBeAttached()
  })

  test('eval bar becomes visible after analysis starts and score arrives', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-start-btn').click()
    // Events include depth-1+ scores; once processed the bar should appear
    await expect(page.getByTestId('engine-eval-bar')).toBeVisible({ timeout: 2000 })
  })
})


test.describe('arrow toggle', () => {
  test('arrow toggle button is present and defaults to active', async ({ boardPageWithEngine: page }) => {
    const btn = page.getByTestId('engine-arrows-btn')
    await expect(btn).toBeVisible()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  test('clicking arrow toggle sets aria-pressed to false', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-arrows-btn').click()
    await expect(page.getByTestId('engine-arrows-btn')).toHaveAttribute('aria-pressed', 'false')
  })

  test('clicking arrow toggle a second time restores aria-pressed to true', async ({ boardPageWithEngine: page }) => {
    await page.getByTestId('engine-arrows-btn').click()
    await page.getByTestId('engine-arrows-btn').click()
    await expect(page.getByTestId('engine-arrows-btn')).toHaveAttribute('aria-pressed', 'true')
  })
})

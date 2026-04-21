/**
 * Folder tree E2E tests.
 *
 * All tests run against a Vite dev server with the Wails IPC bridge replaced
 * by a mock (see fixtures.ts). This lets us test UI behaviour in a real
 * browser without needing the Go backend.
 *
 * Some tests are expected to expose the current regression in the codebase.
 */
import { test, expect } from './fixtures'


/** Right-click a tree item and open the context menu. */
async function openContextMenu(page: import('@playwright/test').Page, folderName: string) {
  await page.getByRole('treeitem', { name: folderName }).click({ button: 'right' })
  // Wait for the context menu to appear
  await page.getByRole('menuitem', { name: 'Rename' }).waitFor()
}

/**
 * The inline edit input rendered inside the arborist tree.
 * Scoped to role="tree" so it never accidentally matches the "Search player…"
 * filter input that lives outside the folder tree.
 */
function treeInput(page: import('@playwright/test').Page) {
  return page.getByTestId('folder-edit-input')
}


test.describe('structure', () => {
  test('shows All Games and Unfiled special entries', async ({ gamesPage: page }) => {
    await expect(page.getByText('All Games')).toBeVisible()
    await expect(page.getByText('Unfiled')).toBeVisible()
  })

  test('shows root-level folders from the data', async ({ gamesPage: page }) => {
    await expect(page.getByRole('treeitem', { name: 'Openings' })).toBeVisible()
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toBeVisible()
  })

  test('child folders are not visible before parent is expanded', async ({ gamesPage: page }) => {
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).not.toBeVisible()
  })
})


test.describe('selection', () => {
  test('All Games is selected by default', async ({ gamesPage: page }) => {
    // The active item uses accent styling — easiest to check via aria-selected
    // on the special entries. They're plain divs, so we verify by checking
    // that no folder treeitem is selected on load.
    const anyFolderSelected = await page
      .getByRole('treeitem')
      .evaluateAll(items =>
        items.some(el => el.getAttribute('aria-selected') === 'true')
      )
    expect(anyFolderSelected).toBe(false)
  })

  test('clicking Unfiled changes selection to Unfiled', async ({ gamesPage: page }) => {
    await page.getByText('Unfiled').click()
    // After clicking Unfiled, no folder in the tree should be selected
    const anyFolderSelected = await page
      .getByRole('treeitem')
      .evaluateAll(items =>
        items.some(el => el.getAttribute('aria-selected') === 'true')
      )
    expect(anyFolderSelected).toBe(false)
  })

  test('clicking a folder marks it as selected', async ({ gamesPage: page }) => {
    await page.getByRole('treeitem', { name: 'Tactics' }).click()
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toHaveAttribute('aria-selected', 'true')
  })

  test('clicking All Games after a folder deselects the tree', async ({ gamesPage: page }) => {
    // Select a folder first
    await page.getByRole('treeitem', { name: 'Tactics' }).click()
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toHaveAttribute('aria-selected', 'true')
    // Click All Games
    await page.getByText('All Games').click()
    // Tree selection should be cleared
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toHaveAttribute('aria-selected', 'false')
  })

  test('clicking a different folder updates selection', async ({ gamesPage: page }) => {
    await page.getByRole('treeitem', { name: 'Tactics' }).click()
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByRole('treeitem', { name: 'Openings' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toHaveAttribute('aria-selected', 'false')
  })
})


test.describe('expand and collapse', () => {
  test('clicking a folder with children expands it to show children', async ({ gamesPage: page }) => {
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).toBeVisible()
  })

  test('clicking an expanded folder collapses it', async ({ gamesPage: page }) => {
    // Expand
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).toBeVisible()
    // Collapse by clicking again
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).not.toBeVisible()
  })

  test('clicking the chevron expands without losing selection on another folder', async ({ gamesPage: page }) => {
    // Select Tactics first
    await page.getByRole('treeitem', { name: 'Tactics' }).click()
    // Expand Openings via its chevron (the button inside the row)
    const openingsRow = page.getByRole('treeitem', { name: 'Openings' })
    await openingsRow.getByRole('button').click()
    // Sicilian should now be visible
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).toBeVisible()
    // Tactics should still be selected
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toHaveAttribute('aria-selected', 'true')
  })

  test('leaf folders do not have a chevron toggle button', async ({ gamesPage: page }) => {
    // Expand Openings so Sicilian is visible
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    const sicilianRow = page.getByRole('treeitem', { name: 'Sicilian' })
    await expect(sicilianRow).toBeVisible()
    // Sicilian is a leaf — it should have no chevron button
    await expect(sicilianRow.getByRole('button')).not.toBeVisible()
  })
})


test.describe('context menu', () => {
  test('right-clicking a folder shows the context menu', async ({ gamesPage: page }) => {
    await page.getByRole('treeitem', { name: 'Tactics' }).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'New subfolder' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  })

  test('Rename opens an inline input pre-filled with the current name', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    const input = treeInput(page)
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('Tactics')
  })

  test('Rename input is focused immediately after opening', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    await expect(treeInput(page)).toBeFocused()
  })

  test('pressing Escape cancels a rename without changing the name', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    await treeInput(page).press('Escape')

    // Input should be gone and the original name should still show
    await expect(treeInput(page)).not.toBeVisible()
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toBeVisible()
  })

  test('pressing Enter submits the rename', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    const input = treeInput(page)
    await input.clear()
    await input.fill('Tactics (renamed)')
    await input.press('Enter')

    // Input should be gone
    await expect(treeInput(page)).not.toBeVisible()
  })
})


test.describe('new subfolder', () => {
  test('New subfolder expands the parent if it was collapsed', async ({ gamesPage: page }) => {
    // Openings starts collapsed
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).not.toBeVisible()

    await openContextMenu(page, 'Openings')
    await page.getByRole('menuitem', { name: 'New subfolder' }).click()

    // Openings should now be expanded (Sicilian visible)
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).toBeVisible()
  })

  test('New subfolder does not collapse an already-expanded parent', async ({ gamesPage: page }) => {
    // Expand Openings first
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).toBeVisible()

    // Open context menu and click New subfolder
    await openContextMenu(page, 'Openings')
    await page.getByRole('menuitem', { name: 'New subfolder' }).click()

    // Openings should still be expanded — Sicilian still visible
    await expect(page.getByRole('treeitem', { name: 'Sicilian' })).toBeVisible()
  })

  test('New subfolder opens an inline input that is empty', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Openings')
    await page.getByRole('menuitem', { name: 'New subfolder' }).click()

    const input = treeInput(page)
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('')
  })

  test('New subfolder input is focused immediately', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Openings')
    await page.getByRole('menuitem', { name: 'New subfolder' }).click()

    await expect(treeInput(page)).toBeFocused()
  })

  test('pressing Escape cancels new subfolder creation', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Openings')
    await page.getByRole('menuitem', { name: 'New subfolder' }).click()

    await treeInput(page).press('Escape')
    await expect(treeInput(page)).not.toBeVisible()
  })

  test('typing a name and pressing Enter creates the subfolder', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Openings')
    await page.getByRole('menuitem', { name: 'New subfolder' }).click()

    await treeInput(page).fill('King\'s Indian')
    await treeInput(page).press('Enter')

    await expect(treeInput(page)).not.toBeVisible()
  })
})


test.describe('new root folder', () => {
  test('clicking the + button in the header opens an inline input', async ({ gamesPage: page }) => {
    // The FolderPlus button is in the Folders header
    await page.getByTitle('New folder').click()

    const input = treeInput(page)
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('')
  })

  test('new root folder input is focused after clicking +', async ({ gamesPage: page }) => {
    await page.getByTitle('New folder').click()
    await expect(treeInput(page)).toBeFocused()
  })
})


test.describe('delete', () => {
  test('Delete from context menu shows the folder deletion confirmation dialog', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    // GamesPage shows a confirmation dialog asking what to do with games
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Delete folder?')).toBeVisible()
  })

  test('deletion dialog shows Keep games and Delete games options', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByRole('button', { name: 'Keep games' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete games' })).toBeVisible()
    await expect(page.getByText('What should happen to the games inside this folder?')).toBeVisible()
  })

  test('clicking Cancel on the deletion dialog closes it without deleting', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    // Folder is still present in the tree
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).toBeVisible()
  })

  test('clicking Keep games deletes the folder and closes the dialog', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Keep games' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).not.toBeVisible()
  })

  test('clicking Delete games deletes the folder and closes the dialog', async ({ gamesPage: page }) => {
    await openContextMenu(page, 'Tactics')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete games' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('treeitem', { name: 'Tactics' })).not.toBeVisible()
  })
})

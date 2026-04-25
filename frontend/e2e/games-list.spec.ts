/**
 * Games list E2E tests.
 *
 * Covers the game table, filtering, sorting, selection, bulk operations,
 * hover row actions, navigation to the board page, and folder-based filtering.
 */
import { test, expect } from './fixtures'


test.describe('empty state', () => {
  test('shows "No games found" when there are no games', async ({ gamesPage: page }) => {
    await expect(page.getByText('No games found')).toBeVisible()
  })

  test('shows import hint text when there are no games', async ({ gamesPage: page }) => {
    await expect(page.getByText(/Import a PGN file or fetch games/i)).toBeVisible()
  })
})


test.describe('game display', () => {
  test('renders a row for each mock game', async ({ gamesListPage: page }) => {
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).toBeVisible()
  })

  test('shows "2 games" count in the header', async ({ gamesListPage: page }) => {
    await expect(page.getByText('2 games')).toBeVisible()
  })

  test('shows result badges for each game', async ({ gamesListPage: page }) => {
    // Both mock games have result '1-0' — scope to tbody to avoid the hidden <option>
    await expect(page.locator('tbody').getByText('1-0').first()).toBeVisible()
  })

  test('shows event and date columns', async ({ gamesListPage: page }) => {
    await expect(page.getByText('World Championship').first()).toBeVisible()
  })
})


test.describe('column sorting', () => {
  // First click on a new column always starts descending (↓); second click goes ascending (↑)
  test('clicking White header sorts descending and shows ↓ indicator', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader', { name: /White/ }).click()
    await expect(page.getByRole('columnheader', { name: /White.*↓/ })).toBeVisible()
    // Kasparov comes before Fischer descending alphabetically
    const rows = page.getByRole('row').filter({ hasText: /Fischer|Kasparov/ })
    await expect(rows.first()).toContainText('Kasparov')
  })

  test('clicking White header again reverses sort and shows ↑', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader', { name: /White/ }).click()
    await page.getByRole('columnheader', { name: /White/ }).click()
    await expect(page.getByRole('columnheader', { name: /White.*↑/ })).toBeVisible()
  })

  test('clicking a different header changes the active sort column', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader', { name: /White/ }).click()
    await expect(page.getByRole('columnheader', { name: /White.*↓/ })).toBeVisible()
    await page.getByRole('columnheader', { name: /Date/ }).click()
    await expect(page.getByRole('columnheader', { name: /Date.*↓/ })).toBeVisible()
    // White column should no longer show sort indicator
    await expect(page.getByRole('columnheader', { name: /White.*[↑↓]/ })).not.toBeVisible()
  })
})


test.describe('filtering', () => {
  test('typing a player name filters the game list', async ({ gamesListPage: page }) => {
    await page.getByPlaceholder('Search player…').fill('Kasparov')
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).not.toBeVisible()
  })

  test('clearing the player filter shows all games again', async ({ gamesListPage: page }) => {
    await page.getByPlaceholder('Search player…').fill('Kasparov')
    await page.getByPlaceholder('Search player…').clear()
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).toBeVisible()
  })

  test('filtering by source shows only matching games', async ({ gamesListPage: page }) => {
    await page.getByRole('combobox', { name: '' }).nth(1).selectOption('lichess')
    // Fischer game has source: lichess; Kasparov game has source: pgn
    await expect(page.getByText('Fischer')).toBeVisible()
    await expect(page.getByText('Kasparov')).not.toBeVisible()
  })

  test('filtering by result shows matching games', async ({ gamesListPage: page }) => {
    await page.getByRole('combobox', { name: '' }).first().selectOption('1-0')
    // Both games have result '1-0' — both should remain visible
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).toBeVisible()
  })

  test('selecting Bullet hides classical games and vice versa', async ({ gamesListPage: page }) => {
    // MOCK_GAMES: Kasparov=60+0 (bullet), Fischer=1800+0 (classical)
    await page.getByRole('button', { name: 'Bullet' }).click()
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).not.toBeVisible()
    // Toggle off
    await page.getByRole('button', { name: 'Bullet' }).click()
    await expect(page.getByText('Fischer')).toBeVisible()
    // Classical alone shows Fischer
    await page.getByRole('button', { name: 'Classical' }).click()
    await expect(page.getByText('Fischer')).toBeVisible()
    await expect(page.getByText('Kasparov')).not.toBeVisible()
  })

  test('selecting multiple time controls is OR-matched', async ({ gamesListPage: page }) => {
    await page.getByRole('button', { name: 'Bullet' }).click()
    await page.getByRole('button', { name: 'Classical' }).click()
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).toBeVisible()
  })

  test('Reset clears time control filter', async ({ gamesListPage: page }) => {
    await page.getByRole('button', { name: 'Bullet' }).click()
    await expect(page.getByText('Fischer')).not.toBeVisible()
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(page.getByText('Fischer')).toBeVisible()
    await expect(page.getByText('Kasparov')).toBeVisible()
  })
})


test.describe('selection', () => {
  test('clicking a row checkbox selects it and shows bulk action bar', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByRole('checkbox').click()
    await expect(page.getByText('1 game selected')).toBeVisible()
  })

  test('clicking select-all checkbox selects all games', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader').getByRole('checkbox').click()
    await expect(page.getByText('2 games selected')).toBeVisible()
  })

  test('clicking Deselect all clears selection and hides bulk bar', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader').getByRole('checkbox').click()
    await page.getByText('Deselect all').click()
    await expect(page.getByText('games selected')).not.toBeVisible()
  })

  test('selecting a game shows Delete button in bulk bar', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByRole('checkbox').click()
    await expect(page.getByRole('button', { name: /Delete 1/ })).toBeVisible()
  })
})


test.describe('bulk delete', () => {
  test('clicking Delete opens the confirmation dialog', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader').getByRole('checkbox').click()
    await page.getByRole('button', { name: /Delete 2/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Delete 2 games?')).toBeVisible()
    await expect(page.getByText('This cannot be undone.')).toBeVisible()
  })

  test('cancelling bulk delete closes dialog and preserves games', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader').getByRole('checkbox').click()
    await page.getByRole('button', { name: /Delete 2/ }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByText('Kasparov')).toBeVisible()
  })

  test('confirming bulk delete removes games and shows notice', async ({ gamesListPage: page }) => {
    await page.getByRole('columnheader').getByRole('checkbox').click()
    await page.getByRole('button', { name: /Delete 2/ }).click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('status')).toContainText('Deleted 2 games')
    await expect(page.getByText('No games found')).toBeVisible()
  })
})


test.describe('open game', () => {
  test('clicking a game row navigates to BoardPage', async ({ gamesListPage: page }) => {
    // Click any non-checkbox cell in the Kasparov row
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click()
    // Home page renders the workspace toolbar
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
  })
})


test.describe('context menu actions', () => {
  test('right-clicking a row shows context menu items', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Analyse' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Move to folder' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Assign to collections' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Guess the Move' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  })

  test('clicking Move to folder from context menu opens MoveFolderDialog', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Move game to folder')).toBeVisible()
  })

  test('clicking Delete from context menu opens the confirmation dialog', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Delete.*game/ })).toBeVisible()
  })
})


test.describe('move folder dialog', () => {
  test('shows folder list from mock data', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Openings')).toBeVisible()
    await expect(dialog.getByText('Tactics')).toBeVisible()
  })

  test('has Remove from folder button', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    await expect(page.getByRole('button', { name: 'Remove from folder' })).toBeVisible()
  })

  test('Move here is disabled until a folder is selected', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    await expect(page.getByRole('button', { name: 'Move here' })).toBeDisabled()
  })

  test('selecting a folder enables Move here button', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Tactics').click()
    await expect(page.getByRole('button', { name: 'Move here' })).toBeEnabled()
  })
})


test.describe('single game row delete', () => {
  test('confirming single game delete removes it from the list', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    // Confirm deletion
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByText('Kasparov')).not.toBeVisible()
    // Other game should still be there
    await expect(page.getByText('Fischer')).toBeVisible()
  })
})


test.describe('move to folder confirm', () => {
  test('selecting a folder and clicking Move here closes the dialog', async ({ gamesListPage: page }) => {
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Tactics').click()
    await page.getByRole('button', { name: 'Move here' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})


test.describe('folder filtering', () => {
  test('shows all games when All Games is selected', async ({ gamesWithFolderPage: page }) => {
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).toBeVisible()
  })

  test('clicking a folder shows only games in that folder', async ({ gamesWithFolderPage: page }) => {
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByText('Kasparov')).toBeVisible()
    await expect(page.getByText('Fischer')).not.toBeVisible()
  })

  test('clicking All Games after a folder resets the filter', async ({ gamesWithFolderPage: page }) => {
    await page.getByRole('treeitem', { name: 'Openings' }).click()
    await expect(page.getByText('Fischer')).not.toBeVisible()
    await page.getByText('All Games').click()
    await expect(page.getByText('Fischer')).toBeVisible()
    await expect(page.getByText('Kasparov')).toBeVisible()
  })

  test('clicking Unfiled shows only games not in a folder', async ({ gamesWithFolderPage: page }) => {
    await page.getByText('Unfiled').click()
    await expect(page.getByText('Fischer')).toBeVisible()
    await expect(page.getByText('Kasparov')).not.toBeVisible()
  })
})


test.describe('refresh', () => {
  test('clicking the refresh button re-fetches games', async ({ gamesListPage: page }) => {
    // Both rows should be visible before refresh
    await expect(page.getByText('Kasparov')).toBeVisible()
    await page.getByTitle('Refresh').click()
    // Games reload from the mock bridge — still visible
    await expect(page.getByText('Kasparov')).toBeVisible()
  })
})


test.describe('filter persistence', () => {
  test('filters survive navigating to Board and back', async ({ gamesListPage: page }) => {
    // Set a player filter — should reduce list to 1 game
    await page.getByPlaceholder('Search player…').fill('Kasparov')
    await expect(page.getByText('1 game')).toBeVisible()

    // Navigate to Home page by clicking the Kasparov row
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click()
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()

    // Navigate back to Games
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()

    // Filter input should still show 'Kasparov'
    await expect(page.getByPlaceholder('Search player…')).toHaveValue('Kasparov')
    // And the list should still be filtered (1 game)
    await expect(page.getByText('1 game')).toBeVisible()
  })

  test('sort order survives navigating to Board and back', async ({ gamesListPage: page }) => {
    // Sort by White ascending
    await page.getByRole('columnheader', { name: /White/ }).click() // descending
    await page.getByRole('columnheader', { name: /White/ }).click() // ascending
    await expect(page.getByRole('columnheader', { name: /White.*↑/ })).toBeVisible()

    // Navigate to Board and back
    await page.locator('tr').filter({ hasText: 'Kasparov' }).getByText('Kasparov').click()
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()

    // Sort indicator should still show ascending White
    await expect(page.getByRole('columnheader', { name: /White.*↑/ })).toBeVisible()
  })
})

import path from 'node:path'
import { test, expect } from '../test-fixtures'
import { startFrameRecording, stopFrameRecording, assertSmooth, writeReport } from '../perf-utils'

/**
 * Folder tree render smoothness. Seeds a 110-folder hierarchy via the
 * existing bound `CreateFolder` IPC (10 parents, each with 10 children),
 * navigates to the Games page, and toggles the first parent's expand state
 * 10 times. Every toggle forces `react-arborist` to re-render the tree with
 * an altered visible-node set.
 *
 * What regression this catches:
 *   - A non-trivial mount cost on FolderTree (class G: hierarchical render)
 *   - `react-arborist` deep-tree quirks or context-menu wiring regressions
 *   - The folder tree sits in permanent view on the games page — any
 *     slowdown here is felt on every navigation to the Games page.
 *
 * This is the only scenario that exercises `react-arborist` and its context
 * menu integration.
 */
test('folder-tree: 110-folder hierarchy, 10 expand/collapse toggles', async ({ wailsPage: page }) => {
  const scenario = 'folder-tree'
  const reportPath = process.env.MASTERBOARD_PERF_REPORT
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'perf-results.jsonl')

  // Seed 10 parents × 10 children via the bound CreateFolder IPC. This runs
  // inside the page so we avoid one Playwright round-trip per call; the Go
  // side does the real work and returns the new folder's UUID.
  await page.waitForFunction(() => {
    const w = window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }
    return Boolean(w.go?.main?.App?.CreateFolder)
  }, { timeout: 5000 })

  await page.evaluate(async () => {
    const w = window as unknown as {
      go: { main: { App: { CreateFolder: (name: string, parent: string | null) => Promise<string> } } }
    }
    for (let i = 0; i < 10; i++) {
      const parentId = await w.go.main.App.CreateFolder(`PerfParent${i.toString().padStart(2, '0')}`, null)
      for (let j = 0; j < 10; j++) {
        await w.go.main.App.CreateFolder(`PerfChild${i.toString().padStart(2, '0')}-${j.toString().padStart(2, '0')}`, parentId)
      }
    }
  })

  // Navigate to the Games page so FolderTree mounts with the seeded data.
  await page.getByRole('link', { name: 'Games' }).click()
  await page.getByText('All Games').waitFor()

  // The first parent we seeded. `react-arborist` renders `role="treeitem"`
  // elements for each folder node; `getByRole` + name picks the one we want
  // regardless of the current scroll position.
  const parent = page.getByRole('treeitem', { name: /PerfParent00/ })
  await parent.waitFor({ state: 'visible', timeout: 5000 })

  await startFrameRecording(page)

  // 10 toggle clicks — each click flips the parent between collapsed and
  // expanded, adding or removing 10 child treeitems from the visible set.
  // The 80 ms gap gives react-arborist's internal layout pass room to finish
  // without artificially coupling frames to the click cadence.
  for (let i = 0; i < 10; i++) {
    await parent.click()
    await page.waitForTimeout(80)
  }

  const metrics = await stopFrameRecording(page)
  await writeReport(reportPath, scenario, metrics)
  expect(metrics.totalFrames).toBeGreaterThan(0)
  assertSmooth(metrics, { minFps: 55, maxDroppedPct: 0.05, maxFrameMs: 50 }, scenario)
})

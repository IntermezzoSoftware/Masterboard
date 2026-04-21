/**
 * Regenerates the checked-in perf fixtures:
 *
 *   frontend/perf/fixtures/small.pgn
 *       500 deterministic synthetic games used by `pgn-import.perf.ts`
 *       (and fed into the master DB for `masterdb-small/`).
 *
 *   frontend/perf/fixtures/masterdb-small/masterboard_master{,_stats,_index}.db
 *       A pre-built split master database built by running a real
 *       StartMasterDBImport against small.pgn. Used by `masterdb-query.perf.ts`
 *       so each test does not have to pay the import cost.
 *
 * Run this once when the master DB schema changes:
 *
 *     task perf:fixtures     # (preferred)
 *     npm run perf:fixtures  # equivalent
 *
 * Requires the instrumented binary. If `build/bin/Masterboard.exe` is missing,
 * build it first with `task build:perf`.
 */

import { chromium, type Page } from '@playwright/test'
import { mkdir, writeFile, copyFile, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchPerfBinary, defaultPerfBinaryPath } from '../wails-launcher'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(HERE, '..', 'fixtures')
const SMALL_PGN_PATH = path.join(FIXTURE_DIR, 'small.pgn')
const MASTERDB_FIXTURE_DIR = path.join(FIXTURE_DIR, 'masterdb-small')

const NUM_GAMES = 500

/**
 * Build a deterministic 500-game PGN as a single string. Every game shares
 * the same 10-ply Ruy Lopez line so the resulting master DB has heavy stats
 * on shared positions (which is what `masterdb-query.perf.ts` exercises) but
 * unique tag headers keep each game distinct at the storage layer.
 */
function buildSmallPgn(): string {
  const moves = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1-0'
  const out: string[] = []
  for (let i = 0; i < NUM_GAMES; i++) {
    out.push(
      '[Event "Perf"]',
      '[Site "Masterboard"]',
      '[Date "2026.01.01"]',
      `[Round "${i + 1}"]`,
      `[White "PerfWhite${i.toString().padStart(4, '0')}"]`,
      `[Black "PerfBlack${i.toString().padStart(4, '0')}"]`,
      '[Result "1-0"]',
      '[ECO "C78"]',
      '',
      moves,
      '',
    )
  }
  return out.join('\n')
}

async function writeSmallPgn(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true })
  await writeFile(SMALL_PGN_PATH, buildSmallPgn(), 'utf8')
  console.log(`[fixtures] wrote ${SMALL_PGN_PATH} (${NUM_GAMES} games)`)
}

/**
 * Launches the instrumented binary, calls real StartMasterDBImport against
 * small.pgn, waits for masterdb:complete, then copies the resulting split
 * DB files out of the temp data dir into `fixtures/masterdb-small/` before
 * the launcher disposes the data dir.
 */
async function buildMasterDb(): Promise<void> {
  const binaryPath = process.env.MASTERBOARD_PERF_BINARY ?? defaultPerfBinaryPath()
  console.log(`[fixtures] launching binary: ${binaryPath}`)

  const handle = await launchPerfBinary({
    binaryPath,
    port: 9500 + Math.floor(Math.random() * 200),
  })

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    browser = await chromium.connectOverCDP(handle.cdpUrl)
    const ctx = browser.contexts()[0]
    if (!ctx) throw new Error('CDP returned zero contexts')

    let page: Page | undefined = ctx.pages()[0]
    if (!page) {
      page = await new Promise<Page>((resolve) => ctx.once('page', resolve))
    }
    await page.waitForLoadState('domcontentloaded').catch(() => { /* already loaded */ })

    await page.waitForFunction(() => {
      const w = window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }
      return Boolean(w.go?.main?.App?.StartMasterDBImport)
    }, { timeout: 15000 })

    console.log(`[fixtures] calling StartMasterDBImport([small.pgn])`)
    const result = await page.evaluate(async (pgnPath: string) => {
      const w = window as unknown as {
        go: { main: { App: { StartMasterDBImport: (paths: string[], replace: boolean) => Promise<unknown> } } }
        runtime: {
          EventsOn: (name: string, cb: (data: unknown) => void) => void
          EventsOff: (name: string) => void
        }
      }
      const done = new Promise<{ success: boolean; errorMsg?: string; gamesIndexed?: number }>((resolve, reject) => {
        const timer = setTimeout(() => {
          w.runtime.EventsOff('masterdb:complete')
          reject(new Error('masterdb:complete timeout after 180 s'))
        }, 180_000)
        w.runtime.EventsOn('masterdb:complete', (data: unknown) => {
          clearTimeout(timer)
          w.runtime.EventsOff('masterdb:complete')
          resolve((data ?? { success: false }) as { success: boolean; errorMsg?: string; gamesIndexed?: number })
        })
      })
      await w.go.main.App.StartMasterDBImport([pgnPath], true)
      return done
    }, SMALL_PGN_PATH)

    if (!result.success) {
      throw new Error(`masterdb import failed: ${result.errorMsg ?? '(no error)'}`)
    }
    console.log(`[fixtures] master DB built (${result.gamesIndexed ?? 0} games indexed)`)

    // Close the CDP link so WAL files can be flushed before we copy.
    try { await browser.close() } catch { /* ignore */ }
    browser = undefined

    await rm(MASTERDB_FIXTURE_DIR, { recursive: true, force: true })
    await mkdir(MASTERDB_FIXTURE_DIR, { recursive: true })

    const entries = await readdir(handle.dataDir)
    let copied = 0
    for (const name of entries) {
      if (!name.startsWith('masterboard_master')) continue
      if (!name.endsWith('.db')) continue
      await copyFile(
        path.join(handle.dataDir, name),
        path.join(MASTERDB_FIXTURE_DIR, name),
      )
      copied++
    }
    if (copied === 0) {
      throw new Error(`no masterboard_master*.db files found in ${handle.dataDir}`)
    }
    console.log(`[fixtures] copied ${copied} master DB files → ${MASTERDB_FIXTURE_DIR}`)
  } finally {
    try { await browser?.close() } catch { /* ignore */ }
    await handle.dispose()
  }
}

async function main(): Promise<void> {
  await writeSmallPgn()
  await buildMasterDb()
  console.log(`[fixtures] done`)
}

main().catch((err) => {
  console.error('[fixtures] FAILED:', err)
  process.exit(1)
})

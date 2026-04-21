import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test'
import { launchPerfBinary, defaultPerfBinaryPath, type WailsPerfHandle } from './wails-launcher'
import path from 'node:path'

export { expect } from '@playwright/test'

/**
 * Resolved location of the fixture directory, relative to this file. Scenarios
 * reference fixtures by base filename (e.g. 'games-2000.db'); the fixture
 * resolver joins them against this path.
 */
export const FIXTURE_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  'fixtures',
)

/**
 * Tag a scenario with the DB fixture it wants seeded. The fixture is copied
 * into the fresh temp data dir before the binary launches, so the app reads a
 * pre-populated SQLite file on startup — faster and more deterministic than
 * seeding through real IPC on every run.
 *
 * `fixture` is a single file under `fixtures/`, copied to `masterboard.db`.
 * `masterFixture` is a subdirectory under `fixtures/`, whose `*.db` entries
 * are shallow-copied into the data dir root (used for split-mode master DBs
 * which are a three-file set: base + `_stats` + `_index`).
 *
 * Pass both undefined to start with an empty data dir (the schema is applied
 * by storage.Open on first launch).
 */
export interface PerfFixtureOptions {
  fixture?: string
  masterFixture?: string
}

interface PerfFixtures {
  /** A connected page driving the real instrumented Wails binary. */
  wailsPage: Page
  /** The Playwright browser context wrapping the CDP connection. */
  wailsContext: BrowserContext
  /** Raw launcher handle — exposed for advanced scenarios. */
  wailsHandle: WailsPerfHandle
}

/**
 * The perf test fixture. Each scenario gets a fresh instrumented Wails
 * binary, wired over CDP, with data isolated to a temp dir. The fixture
 * verifies the binary was built with `-tags perf` by emitting a __perf:ping
 * and waiting for a matching __perf:ack — if no ack comes back in 2 s, the
 * test fails fast with a clear error.
 *
 * Fresh-per-test isolation trades ~3 s of binary boot for bulletproof state
 * separation. With ~8 scenarios that is ~24 s of overhead per suite run —
 * cheap compared to tracking down bleed between tests.
 */
export const test = base.extend<{ perfFixture: PerfFixtureOptions } & PerfFixtures>({
  perfFixture: [{ fixture: undefined, masterFixture: undefined }, { option: true }],

  wailsHandle: async ({ perfFixture }, use) => {
    const binaryPath = process.env.MASTERBOARD_PERF_BINARY ?? defaultPerfBinaryPath()
    const fixtureDb = perfFixture.fixture
      ? path.join(FIXTURE_DIR, perfFixture.fixture)
      : undefined
    const fixtureMasterDir = perfFixture.masterFixture
      ? path.join(FIXTURE_DIR, perfFixture.masterFixture)
      : undefined

    const handle = await launchPerfBinary({
      binaryPath,
      port: 9222 + Math.floor(Math.random() * 200),
      fixtureDb,
      fixtureMasterDir,
    })
    try {
      await use(handle)
    } finally {
      await handle.dispose()
    }
  },

  wailsContext: async ({ wailsHandle }, use) => {
    const browser = await chromium.connectOverCDP(wailsHandle.cdpUrl)
    const ctx = browser.contexts()[0]
    if (!ctx) throw new Error('CDP connect returned zero contexts')
    await use(ctx)
    try { await browser.close() } catch { /* ignore */ }
  },

  wailsPage: async ({ wailsContext }, use) => {
    // The Wails WebView2 has exactly one page (the Masterboard UI). Wait for
    // it to exist — a very cold start may still be initialising the DOM.
    let page: Page | undefined = wailsContext.pages()[0]
    if (!page) {
      page = await new Promise<Page>((resolve) => {
        wailsContext.once('page', resolve)
      })
    }
    await page.waitForLoadState('load').catch(() => { /* already loaded */ })

    // Fresh WebView2 profiles (MASTERBOARD_WEBVIEW_USER_DATA_PATH) can still
    // be navigating when CDP first attaches. Wait for the Wails runtime
    // bridge to be exposed on window before pinging — otherwise
    // page.evaluate can race with an in-flight navigation and the execution
    // context gets destroyed mid-eval.
    await page.waitForFunction(
      () => {
        const w = window as unknown as { runtime?: { EventsEmit?: unknown; EventsOnce?: unknown } }
        return !!w.runtime && typeof w.runtime.EventsEmit === 'function' && typeof w.runtime.EventsOnce === 'function'
      },
      undefined,
      { timeout: 10000 },
    ).catch(() => { /* fall through to handshake; it will fail loudly */ })

    // Handshake: ping the perf event bus. If no ack arrives the binary
    // almost certainly wasn't built with `-tags perf`.
    const acked = await page.evaluate(async () => {
      const w = window as unknown as {
        runtime?: {
          EventsEmit: (name: string, ...args: unknown[]) => void
          EventsOnce: (name: string, cb: (...args: unknown[]) => void) => void
        }
      }
      if (!w.runtime) return false
      return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000)
        w.runtime!.EventsOnce('__perf:ack', (data: unknown) => {
          clearTimeout(timer)
          const d = data as { cmd?: string } | undefined
          resolve(d?.cmd === 'ping')
        })
        w.runtime!.EventsEmit('__perf:ping')
      })
    })
    if (!acked) {
      throw new Error(
        'Perf harness handshake failed: no __perf:ack response within 2 s. ' +
        'The Masterboard binary must be built with `wails build -tags perf`. ' +
        'Run `npm run perf:build` first, or point MASTERBOARD_PERF_BINARY at an instrumented binary.',
      )
    }

    await use(page)
  },
})

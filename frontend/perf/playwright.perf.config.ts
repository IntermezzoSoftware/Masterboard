import { defineConfig } from '@playwright/test'

/**
 * Perf-harness Playwright config. Unlike the e2e suite, this config does NOT
 * start a dev server — each scenario's fixture spawns the real instrumented
 * Wails binary, opens a CDP session against its WebView2 instance, and drives
 * the app through its real IPC stack.
 *
 * See frontend/perf/README.md for the full pipeline and how to add scenarios.
 */
export default defineConfig({
  testDir: './scenarios',
  testMatch: /.*\.perf\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Per-scenario budget: binary boot (~3 s) + scripted interaction + metric
  // collection. Keep this generous — perf scenarios that time out are not
  // actionable, we want full traces instead.
  timeout: 90_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'perf-playwright.json' }],
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    // No baseURL — we connect to an externally launched browser via CDP.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})

import { defineConfig, devices } from '@playwright/test'

/**
 * Frontend-only perf fallback config. Runs against a production Vite
 * preview (not the real Wails binary), using the existing e2e IPC mock in
 * `frontend/e2e/fixtures.ts`. Useful for:
 *   - Fast pre-push smoke checks of pure CSS / React regressions
 *   - Developing perf scenarios without having to rebuild the Go binary
 *   - CI environments where the Wails binary cannot run
 *
 * It does NOT exercise the Wails IPC bridge, Go backend, or real Stockfish.
 * For end-to-end perf measurement that includes IPC cost, use
 * `playwright.perf.config.ts` + the real instrumented binary.
 *
 * This config targets the Vite `preview` server (port 4173 by default), which
 * serves a production React bundle — React.StrictMode is a no-op in
 * production, eliminating the dev-mode double-render noise that makes
 * `wails dev` profiling unreliable.
 */
export default defineConfig({
  testDir: './scenarios',
  testMatch: /.*\.perf\.fe\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'perf-playwright-fe.json' }],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})

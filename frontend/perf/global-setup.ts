import { initReport } from './perf-utils'
import path from 'node:path'
import { access } from 'node:fs/promises'
import { defaultPerfBinaryPath } from './wails-launcher'

/**
 * Playwright globalSetup hook. Clears the per-run JSONL report and verifies
 * that a binary actually exists at the expected path. Fails fast with a
 * helpful message if the user forgot to run `wails build -tags perf`.
 */
export default async function globalSetup(): Promise<void> {
  const reportPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '..',
    'perf-results.jsonl',
  )
  await initReport(reportPath)
  process.env.MASTERBOARD_PERF_REPORT = reportPath

  const binaryPath = process.env.MASTERBOARD_PERF_BINARY ?? defaultPerfBinaryPath()
  try {
    await access(binaryPath)
  } catch {
    throw new Error(
      `Instrumented Wails binary not found at ${binaryPath}. ` +
      `Build it first with:\n\n    wails build -tags perf\n\n` +
      `or point MASTERBOARD_PERF_BINARY at an existing instrumented binary.`,
    )
  }
}

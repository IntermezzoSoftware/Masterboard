/**
 * Playwright globalTeardown hook. The per-test fixture already disposes
 * each binary individually, so teardown is a no-op placeholder reserved
 * for future whole-run cleanup (e.g. summarising perf-results.jsonl).
 */
export default async function globalTeardown(): Promise<void> {
  // reserved
}

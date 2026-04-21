import type { Page, CDPSession } from '@playwright/test'
import { appendFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Summary statistics for a frame-timing recording. All durations are in
 * milliseconds. `dropped` counts frames whose delta exceeded 20 ms (below
 * 50 FPS); `longDropped` counts frames whose delta exceeded 100 ms (a
 * visibly stuttering hitch). `effectiveFps` is derived from the mean frame
 * delta so it reports sustained smoothness, not just a peak.
 */
export interface FrameMetrics {
  totalFrames: number
  mean_ms: number
  median_ms: number
  p95_ms: number
  max_ms: number
  dropped: number
  /** Frames with delta > 100 ms — "long stalls" / user-visible hitches. */
  longDropped: number
  effectiveFps: number
}

/**
 * Installs a requestAnimationFrame loop in the page that timestamps every
 * animation frame. Call `stopFrameRecording` to retrieve the captured
 * frames as `FrameMetrics`.
 *
 * This runs entirely inside the page's render thread, so it measures real
 * frame cadence — the same thing the user sees. Any JS or layout work that
 * stalls the main thread shows up as gaps between timestamps.
 */
export async function startFrameRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Fresh array per run.
    ;(window as unknown as { __frames?: number[] }).__frames = []
    const frames = (window as unknown as { __frames: number[] }).__frames
    const tick = (t: number) => {
      frames.push(t)
      ;(window as unknown as { __frameRaf?: number }).__frameRaf =
        requestAnimationFrame(tick)
    }
    ;(window as unknown as { __frameRaf?: number }).__frameRaf =
      requestAnimationFrame(tick)
  })
}

/**
 * Stops the active frame recording and returns computed metrics. Safe to
 * call even if no recording is active — returns a zeroed metrics object.
 */
export async function stopFrameRecording(page: Page): Promise<FrameMetrics> {
  const frames: number[] = await page.evaluate(() => {
    const w = window as unknown as { __frames?: number[]; __frameRaf?: number }
    if (typeof w.__frameRaf === 'number') {
      cancelAnimationFrame(w.__frameRaf)
      w.__frameRaf = undefined
    }
    const frames = w.__frames ?? []
    w.__frames = []
    return frames
  })

  if (frames.length < 2) {
    return {
      totalFrames: frames.length,
      mean_ms: 0,
      median_ms: 0,
      p95_ms: 0,
      max_ms: 0,
      dropped: 0,
      longDropped: 0,
      effectiveFps: 0,
    }
  }

  const deltas: number[] = []
  for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1])
  const sorted = [...deltas].sort((a, b) => a - b)
  const mean = deltas.reduce((s, v) => s + v, 0) / deltas.length
  const median = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const max = sorted[sorted.length - 1]
  const dropped = deltas.filter((d) => d > 20).length
  const longDropped = deltas.filter((d) => d > 100).length

  return {
    totalFrames: frames.length,
    mean_ms: round(mean),
    median_ms: round(median),
    p95_ms: round(p95),
    max_ms: round(max),
    dropped,
    longDropped,
    effectiveFps: round(1000 / mean),
  }
}

function round(n: number, decimals = 2) {
  const k = 10 ** decimals
  return Math.round(n * k) / k
}

export interface SmoothAssertions {
  /** Minimum sustained frames-per-second. Default 55. */
  minFps?: number
  /** Maximum ratio of dropped frames (0–1). Default 0.05 (5 %). */
  maxDroppedPct?: number
  /** Hardest single frame allowed. Default 50 ms (one skipped vsync). */
  maxFrameMs?: number
  /**
   * Maximum count of long-stall frames (>100 ms). Default: unchecked.
   * Used by scenarios that only care about user-visible hitches, e.g. the
   * PGN import scenario where Go is legitimately busy but the UI must
   * never fully freeze for more than 100 ms at a stretch.
   */
  maxLongDropped?: number
}

/**
 * Throws if the recorded metrics do not meet smoothness thresholds.
 * Error messages include the full metrics object so Playwright failure
 * reports are useful.
 */
export function assertSmooth(
  metrics: FrameMetrics,
  opts: SmoothAssertions = {},
  scenario = 'scenario',
): void {
  const minFps = opts.minFps ?? 55
  const maxDroppedPct = opts.maxDroppedPct ?? 0.05
  const maxFrameMs = opts.maxFrameMs ?? 50
  const droppedPct = metrics.totalFrames > 0
    ? metrics.dropped / metrics.totalFrames
    : 0

  const failures: string[] = []
  if (metrics.effectiveFps < minFps) {
    failures.push(
      `effectiveFps ${metrics.effectiveFps} < ${minFps}`,
    )
  }
  if (droppedPct > maxDroppedPct) {
    failures.push(
      `dropped ${metrics.dropped}/${metrics.totalFrames} = ${(droppedPct * 100).toFixed(1)}% > ${(maxDroppedPct * 100).toFixed(1)}%`,
    )
  }
  if (metrics.max_ms > maxFrameMs) {
    failures.push(`max_ms ${metrics.max_ms} > ${maxFrameMs}`)
  }
  if (opts.maxLongDropped !== undefined && metrics.longDropped > opts.maxLongDropped) {
    failures.push(
      `longDropped ${metrics.longDropped} > ${opts.maxLongDropped} (frames > 100 ms)`,
    )
  }

  if (failures.length > 0) {
    throw new Error(
      `[${scenario}] smoothness violated: ${failures.join('; ')}; full metrics: ${JSON.stringify(metrics)}`,
    )
  }
}

/**
 * Appends a scenario result to a JSONL report file. The file is a stream of
 * one-object-per-line records so PRs can diff scenarios against the baseline
 * without having to reparse a whole JSON document.
 */
export async function writeReport(
  reportPath: string,
  scenario: string,
  metrics: FrameMetrics,
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true })
  const row = {
    scenario,
    timestamp: new Date().toISOString(),
    ...metrics,
  }
  await appendFile(reportPath, JSON.stringify(row) + '\n', 'utf8')
}

/**
 * Clears the report file at the start of a run so only the current run's
 * results are captured. Called by global-setup.
 */
export async function initReport(reportPath: string): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, '', 'utf8')
}

/**
 * Starts a Chrome DevTools Protocol trace on the active page. The returned
 * disposer stops the trace and writes the resulting timeline JSON to the
 * given path, loadable in chrome://tracing or the DevTools Performance tab
 * for root-cause investigation of a failed scenario.
 *
 * Uses `transferMode: 'ReturnAsStream'` — `Tracing.tracingComplete` returns
 * a stream handle which we read incrementally via the `IO.read` domain.
 * This is the only mode that works for large traces (tens of MB); the
 * alternative `ReportEvents` mode fires many `Tracing.dataCollected` events
 * which Chromium caps at a fixed internal buffer size.
 *
 * The `tracingComplete` listener must be installed *before* we send
 * `Tracing.end`, otherwise we race the event and miss the stream handle.
 *
 * WebView2 supports the Tracing domain informally (inherited from Chromium);
 * this call is best-effort and should be wrapped in try/catch by the caller.
 */
export async function startCdpTrace(
  page: Page,
  categories: string[] = [
    '-*',
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
  ],
): Promise<{ stop: (outPath: string) => Promise<void>; session: CDPSession }> {
  const session = await page.context().newCDPSession(page)
  await session.send('Tracing.start', {
    categories: categories.join(','),
    options: 'sampling-frequency=10000',
    transferMode: 'ReturnAsStream',
  })

  const stop = async (outPath: string) => {
    // Attach the completion listener BEFORE calling Tracing.end so we don't
    // race against the event — the handle comes back on this event and we
    // need it to read the stream.
    const handlePromise = new Promise<string>((resolve, reject) => {
      session.once('Tracing.tracingComplete', (data: { stream?: string }) => {
        if (data?.stream) resolve(data.stream)
        else reject(new Error('Tracing.tracingComplete did not include a stream handle'))
      })
    })
    await session.send('Tracing.end')
    const handle = await handlePromise

    // Read the stream in chunks. IO.read returns base64 when
    // base64Encoded=true; otherwise it returns raw UTF-8 text. The trace
    // stream is JSON, so raw UTF-8 is fine — we concatenate chunks and
    // write them to disk as-is (it's already a valid trace document).
    const chunks: string[] = []
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, eof, base64Encoded } = await session.send('IO.read', {
        handle,
        size: 1024 * 1024,
      }) as { data: string; eof: boolean; base64Encoded?: boolean }
      if (base64Encoded) {
        chunks.push(Buffer.from(data, 'base64').toString('utf8'))
      } else {
        chunks.push(data)
      }
      if (eof) break
    }
    await session.send('IO.close', { handle })
    await mkdir(path.dirname(outPath), { recursive: true })
    // Chromium returns the stream as a complete trace document
    // ({"traceEvents":[...],"metadata":{...}}), so we write it verbatim
    // rather than wrapping it again.
    await writeFile(outPath, chunks.join(''), 'utf8')
  }

  return { stop, session }
}

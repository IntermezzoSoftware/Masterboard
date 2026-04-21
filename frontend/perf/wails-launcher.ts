import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, mkdir, copyFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createWriteStream } from 'node:fs'

/**
 * Handle for a launched instrumented Wails binary. Used to clean up after
 * a perf scenario finishes.
 */
export interface WailsPerfHandle {
  process: ChildProcess
  cdpUrl: string
  dataDir: string
  /** Full path to the log file capturing binary stdout/stderr. */
  logPath: string
  dispose: () => Promise<void>
}

export interface LaunchOptions {
  /** Absolute path to the built binary. Must be built with `-tags perf`. */
  binaryPath: string
  /** Remote debugging port exposed on WebView2. Defaults to 9222. */
  port?: number
  /**
   * Optional fixture SQLite file to seed the data dir with. Copied to
   * `<dataDir>/masterboard.db` before the binary is launched.
   */
  fixtureDb?: string
  /**
   * Optional directory containing pre-built master-database files. Every
   * `*.db` entry in the directory is shallow-copied into the data dir root
   * before the binary boots. The master DB is a split three-file set
   * (`masterboard_master.db`, `..._stats.db`, `..._index.db`) so a single
   * file wouldn't be enough.
   */
  fixtureMasterDir?: string
  /**
   * How long to wait for the CDP endpoint to come up before giving up.
   * Defaults to 15 s — real WebView2 cold starts can be slow on Windows.
   */
  bootTimeoutMs?: number
}

/**
 * Launches the instrumented Wails binary with remote debugging + data
 * isolation, waits for its CDP endpoint to respond, and returns a handle
 * the caller can use to connect and — eventually — dispose.
 *
 * The caller is responsible for calling `handle.dispose()` to terminate the
 * binary and clean up the temp data directory. A Playwright fixture should
 * always call dispose in a `test.afterEach` / `finally` block so a failing
 * scenario doesn't leak a running Masterboard.exe process.
 */
export async function launchPerfBinary(opts: LaunchOptions): Promise<WailsPerfHandle> {
  const port = opts.port ?? 9222
  const bootTimeoutMs = opts.bootTimeoutMs ?? 15_000

  const dataDir = await mkdtemp(path.join(tmpdir(), 'mb-perf-'))
  await mkdir(dataDir, { recursive: true })

  // Dedicated WebView2 user-data directory so each test gets a pristine
  // Chromium profile: fresh localStorage, fresh cookies, fresh cache. Without
  // this, the panel-layout persistence in localStorage bleeds between runs and
  // scenarios that toggle panels (e.g. masterdb-query opening the Explorer)
  // see stale state from the previous run.
  const webviewDataDir = path.join(dataDir, 'webview2')
  await mkdir(webviewDataDir, { recursive: true })

  if (opts.fixtureDb) {
    await copyFile(opts.fixtureDb, path.join(dataDir, 'masterboard.db'))
  }

  if (opts.fixtureMasterDir) {
    const entries = await readdir(opts.fixtureMasterDir)
    for (const name of entries) {
      if (!name.endsWith('.db')) continue
      await copyFile(
        path.join(opts.fixtureMasterDir, name),
        path.join(dataDir, name),
      )
    }
  }

  const logPath = path.join(dataDir, 'binary.log')
  const logStream = createWriteStream(logPath)

  const child = spawn(opts.binaryPath, [], {
    env: {
      ...process.env,
      // MASTERBOARD_PERF_WEBVIEW_ARGS is consumed by the Masterboard-patched
      // go-webview2 (see third_party/go-webview2/PATCH_NOTES.md). It is
      // merged into Wails' AdditionalBrowserArgs at WebView2 Embed() time,
      // which is the only channel that actually reaches Chromium in a
      // Wails v2 app — WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is wiped by
      // Wails at package init and can't be used for this purpose.
      MASTERBOARD_PERF_WEBVIEW_ARGS: `--remote-debugging-port=${port}`,
      MASTERBOARD_DATA_DIR: dataDir,
      // Read in main.go to set Wails' WebviewUserDataPath, isolating the
      // Chromium profile (localStorage, etc.) per test.
      MASTERBOARD_WEBVIEW_USER_DATA_PATH: webviewDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child.stdout?.pipe(logStream)
  child.stderr?.pipe(logStream)

  // Fail fast if the child dies during boot.
  let childExited = false
  child.once('exit', (code, signal) => {
    childExited = true
    logStream.write(`\n[launcher] binary exited code=${code} signal=${signal}\n`)
  })

  const cdpUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + bootTimeoutMs
  let lastErr: unknown = null

  while (Date.now() < deadline) {
    if (childExited) {
      throw new Error(
        `Wails binary exited before CDP came up. See ${logPath}`,
      )
    }
    try {
      const res = await fetch(`${cdpUrl}/json/version`)
      if (res.ok) {
        await res.json()
        // Endpoint alive.
        break
      }
    } catch (err) {
      lastErr = err
    }
    await sleep(150)
  }
  if (Date.now() >= deadline) {
    try { child.kill() } catch { /* ignore */ }
    throw new Error(
      `CDP endpoint at ${cdpUrl} never responded within ${bootTimeoutMs} ms. ` +
      `Last error: ${lastErr}. Binary log: ${logPath}`,
    )
  }

  const dispose = async () => {
    try { child.kill() } catch { /* ignore */ }
    // Give it a short grace period, then force kill.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        resolve()
      }, 2000)
      child.once('exit', () => { clearTimeout(t); resolve() })
    })
    logStream.end()
    try {
      await rm(dataDir, { recursive: true, force: true })
    } catch { /* best-effort cleanup */ }
  }

  return { process: child, cdpUrl, dataDir, logPath, dispose }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Absolute path to the Masterboard Wails binary that the harness drives.
 * Resolved relative to the frontend/ directory so the harness keeps working
 * whether it is invoked from the repo root or from frontend/.
 *
 * The caller is responsible for ensuring the binary was built with
 * `wails build -tags perf` — otherwise the __perf:ping handshake in
 * test-fixtures.ts will fail and the suite aborts fast.
 */
export function defaultPerfBinaryPath(): string {
  // perf/ lives at frontend/perf, build/bin at repo root.
  // import.meta.url is preferred over __dirname under ESM.
  const thisFile = new URL(import.meta.url).pathname
  const perfDir = path.dirname(thisFile.replace(/^\/([A-Za-z]:)/, '$1'))
  const repoRoot = path.resolve(perfDir, '..', '..')
  const name = process.platform === 'win32' ? 'Masterboard.exe' : 'Masterboard'
  return path.join(repoRoot, 'build', 'bin', name)
}

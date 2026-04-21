import { useEffect, useState } from 'react'
import { CheckCircle2, Download } from 'lucide-react'
import { EventsOn } from '@/lib/wailsRuntime'
import { api, type DownloadableEngine, type EngineEntry } from '@/lib/api'
import { btnPrimary } from '@/lib/classNames'

interface EngineProgress {
  percent: number
  done: boolean
  error: string | null
}

export function isEngineInstalled(engine: DownloadableEngine, availableEngines: EngineEntry[]): boolean {
  const id = engine.id.toLowerCase()
  return availableEngines.some(e => {
    const filename = e.path.split(/[\\/]/).pop() ?? ''
    return filename.toLowerCase().includes(id) || e.name.toLowerCase().includes(engine.name.toLowerCase())
  })
}

interface Props {
  availableEngines: EngineEntry[]
  onInstalled?: () => void
}

export function EngineDownloadList({ availableEngines, onInstalled }: Props) {
  const [engines, setEngines] = useState<DownloadableEngine[]>([])
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<EngineEntry[]>(availableEngines)
  const [progress, setProgress] = useState<Record<string, EngineProgress>>({})
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  useEffect(() => {
    setInstalled(availableEngines)
  }, [availableEngines])

  useEffect(() => {
    api.getDownloadableEngines()
      .then(list => setEngines(list))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const u1 = EventsOn('engine:download-progress', (p: { engineID: string; percent: number }) => {
      setProgress(prev => ({ ...prev, [p.engineID]: { percent: p.percent, done: false, error: null } }))
    })
    const u2 = EventsOn('engine:download-complete', (p: { engineID: string }) => {
      setProgress(prev => ({ ...prev, [p.engineID]: { percent: 100, done: true, error: null } }))
      setDownloadingId(null)
      api.getEngineState().then(s => {
        setInstalled(s.availableEngines)
        onInstalled?.()
      }).catch(() => {})
    })
    const u3 = EventsOn('engine:download-error', (p: { engineID: string; error: string }) => {
      setProgress(prev => ({ ...prev, [p.engineID]: { percent: 0, done: false, error: p.error } }))
      setDownloadingId(null)
    })
    return () => { u1(); u2(); u3() }
  }, [onInstalled])

  function handleDownload(engine: DownloadableEngine) {
    setDownloadingId(engine.id)
    setProgress(prev => ({ ...prev, [engine.id]: { percent: 0, done: false, error: null } }))
    api.downloadEngine(engine.id).catch(() => {})
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <svg className="animate-spin h-5 w-5 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (engines.length === 0) {
    return (
      <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        No downloadable engines available.
      </p>
    )
  }

  const isDownloading = downloadingId !== null

  return (
    <div className="flex flex-col gap-4">
      {engines.map(engine => {
        const inst = isEngineInstalled(engine, installed)
        const prog = progress[engine.id]
        const isDone = prog?.done || inst
        const inProgress = downloadingId === engine.id && !prog?.done

        return (
          <div
            key={engine.id}
            className="flex flex-col gap-1.5 pb-4 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] last:border-b-0 last:pb-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                    {engine.name}
                  </span>
                  <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {engine.version}
                  </span>
                  {isDone && (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                      <CheckCircle2 size={11} aria-hidden="true" /> Installed
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mt-0.5">
                  {engine.description}
                </p>
              </div>

              {!isDone && !inProgress && (
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={isDownloading}
                  onClick={() => handleDownload(engine)}
                >
                  <Download size={13} aria-hidden="true" /> Download
                </button>
              )}
            </div>

            {inProgress && (
              <div className="flex flex-col gap-1">
                <div className="h-1.5 w-full rounded-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] transition-all duration-200"
                    style={{ width: `${prog?.percent ?? 0}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  {prog?.percent ?? 0}%
                </span>
              </div>
            )}

            {prog?.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{prog.error}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

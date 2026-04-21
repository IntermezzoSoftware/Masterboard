import { useState, useEffect } from 'react'
import { Loader2, X } from 'lucide-react'
import { EventsOn } from '@/lib/wailsRuntime'
import { api, type AnalysisQueueUpdate } from '@/lib/api'

export default function BatchAnalysisStatus() {
  const [status, setStatus] = useState<AnalysisQueueUpdate | null>(null)

  useEffect(() => {
    api.getQueueStatus().then(setStatus).catch(() => {})
    return EventsOn('analysis:queue-update', (s: AnalysisQueueUpdate) => setStatus(s))
  }, [])

  if (!status || (status.remaining === 0 && status.active === 0)) return null

  const total = status.remaining + status.active
  const label = total === 1 ? '1 game' : `${total} games`

  return (
    <div className="px-2 py-2 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
      <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)]">
        <Loader2
          size={14}
          strokeWidth={2}
          className="shrink-0 animate-spin text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]"
          aria-hidden="true"
        />
        <span className="flex-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate">
          Analysing {label}
        </span>
        <button
          onClick={() => api.cancelAnalysis().catch(() => {})}
          title="Cancel analysis"
          aria-label="Cancel analysis"
          className="shrink-0 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors cursor-pointer"
        >
          <X size={13} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

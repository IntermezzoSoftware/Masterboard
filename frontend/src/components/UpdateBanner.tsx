import { useEffect, useState } from 'react'
import { X, ArrowUpCircle } from 'lucide-react'
import { EventsOn } from '@/lib/wailsRuntime'
import { api } from '@/lib/api'

const RELEASES_URL = 'https://github.com/IntermezzoSoftware/Masterboard/releases'

export default function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    return EventsOn('app:update-available', (v: string) => setVersion(v))
  }, [])

  if (!version) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-3 py-1.5 text-xs bg-[var(--color-accent)] text-white shrink-0"
    >
      <ArrowUpCircle size={13} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">
        Update available — v{version}
        {' '}
        <button
          onClick={() => api.openURL(RELEASES_URL)}
          className="underline hover:no-underline font-medium cursor-pointer"
        >
          Download
        </button>
      </span>
      <button
        onClick={() => setVersion(null)}
        aria-label="Dismiss update notification"
        className="hover:opacity-75 cursor-pointer"
      >
        <X size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}

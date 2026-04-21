import { useEffect, useRef, useState } from 'react'
import { EventsOn } from '@/lib/wailsRuntime'
import logoFullSvg from '@/assets/logo-full.svg?raw'

const MIN_MS  = 1750
const EXIT_MS = 850

function getTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem('masterboard-theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function SplashScreen({ onDone, onExiting }: { onDone: () => void; onExiting?: () => void }) {
  const theme = useRef(getTheme()).current
  const [exiting, setExiting] = useState(false)
  const timerDoneRef = useRef(false)
  const appReadyRef  = useRef(false)
  const exitingRef   = useRef(false)

  function maybeExit() {
    if (timerDoneRef.current && appReadyRef.current && !exitingRef.current) {
      exitingRef.current = true
      onExiting?.()
      setExiting(true)
      setTimeout(onDone, EXIT_MS)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => {
      timerDoneRef.current = true
      maybeExit()
    }, MIN_MS)
    return () => clearTimeout(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return EventsOn('app:ready', () => {
      appReadyRef.current = true
      maybeExit()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const bgColor   = theme === 'dark' ? '#111213' : '#fafafa'
  const logoColor = theme === 'dark' ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,20,0.90)'

  return (
    <div
      data-testid="splash-overlay"
      className={`fixed inset-0 z-[9999] flex items-center justify-center${exiting ? ' splash-overlay-exit' : ''}`}
      style={{ background: bgColor }}
    >
      <div
        style={{ width: 320, color: logoColor }}
        className={exiting ? 'splash-exit' : 'splash-enter'}
        dangerouslySetInnerHTML={{ __html: logoFullSvg }}
      />
    </div>
  )
}

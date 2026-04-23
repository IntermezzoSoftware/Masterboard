import { useEffect, useRef, useState } from 'react'
import { EventsOn } from '@/lib/wailsRuntime'
import logoFullSvg from '@/assets/logo-full.svg?raw'

const MIN_MS  = 1750
const EXIT_MS = 850

// Register the app:ready listener at module load time — before React mounts
// or commits any effects — so we never miss the event. On macOS, WKWebView
// fires domReady (and therefore the Go domReady() callback) earlier in the JS
// execution lifecycle than WebView2 does on Windows, creating a reliable race
// where app:ready arrives before the useEffect-based listener is registered.
let _appReadyFired = false
const _appReadyQueue: Array<() => void> = []
EventsOn('app:ready', () => {
  _appReadyFired = true
  _appReadyQueue.splice(0).forEach(fn => fn())
})

function onAppReady(fn: () => void): () => void {
  if (_appReadyFired) {
    fn()
    return () => {}
  }
  _appReadyQueue.push(fn)
  return () => {
    const i = _appReadyQueue.indexOf(fn)
    if (i !== -1) _appReadyQueue.splice(i, 1)
  }
}

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
    return onAppReady(() => {
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

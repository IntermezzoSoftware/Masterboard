import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { EventsOn } from '@/lib/wailsRuntime'
import { api, type EngineEntry, type EngineInfo, type EngineType } from '@/lib/api'

export interface EngineAnalysisHook {
  fen: string
  isAnalysing: boolean
  isReady: boolean
  lines: EngineInfo[]
  currentDepth: number
  analysisFen: string
  multiPV: number
  showArrows: boolean
  availableEngines: EngineEntry[]
  activeEngine: string
  engineName: string
  engineType: EngineType
  startAnalysis: () => void
  stopAnalysis: () => void
  setMultiPV: (n: number) => void
  toggleArrows: () => void
  setActiveEngine: (path: string) => void
  navigateToPV?: (analysisFen: string, uciMoves: string[]) => void
}


const LS = {
  multiPV:    'masterboard-engine-multiPV',
  showArrows: 'masterboard-engine-showArrows',
}

function lsLoadInt(key: string, defaultVal: number, min: number): number {
  try {
    const s = localStorage.getItem(key)
    if (s === null) return defaultVal
    const n = parseInt(s, 10)
    return isNaN(n) || n < min ? defaultVal : n
  } catch {
    return defaultVal
  }
}

function lsLoadBool(key: string, defaultVal: boolean): boolean {
  try {
    const s = localStorage.getItem(key)
    if (s === null) return defaultVal
    return s === 'true'
  } catch {
    return defaultVal
  }
}

export function useEngineAnalysis(fen: string, slot: 'primary' | 'secondary' = 'primary'): EngineAnalysisHook {
  const isSecondary = slot === 'secondary'
  const LS_KEYS = {
    multiPV: isSecondary ? 'masterboard-engine2-multiPV' : LS.multiPV,
  }
  const INFO_EVENT  = isSecondary ? 'engine2:info'  : 'engine:info'
  const READY_EVENT = isSecondary ? 'engine2:ready' : 'engine:ready'
  const API = isSecondary
    ? {
        getEngineState:  () => api.getEngineState2(),
        startAnalysis:   (f: string, n: number) => api.startAnalysis2(f, n),
        stopAnalysis:    () => api.stopAnalysis2(),
        setActiveEngine: (p: string) => api.setActiveEngine2(p),
      }
    : {
        getEngineState:  () => api.getEngineState(),
        startAnalysis:   (f: string, n: number) => api.startAnalysis(f, n),
        stopAnalysis:    () => api.stopAnalysis(),
        setActiveEngine: (p: string) => api.setActiveEngine(p),
      }
  const [isReady, setIsReady] = useState(false)
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [lines, setLines] = useState<EngineInfo[]>([])
  const [currentDepth, setCurrentDepth] = useState(0)
  const [analysisFen, setAnalysisFen] = useState('')
  const [multiPV, setMultiPVState] = useState(() => lsLoadInt(LS_KEYS.multiPV, 1, 1))
  const [showArrows, setShowArrows] = useState(() => lsLoadBool(LS.showArrows, true))
  const [availableEngines, setAvailableEngines] = useState<EngineEntry[]>([])
  const [activeEngine, setActiveEngineState] = useState('')
  const [engineName, setEngineName] = useState('')
  const [engineType, setEngineType] = useState<EngineType>('ab')

  // Refs so effects/callbacks always see the latest values without re-registering
  const isAnalysingRef = useRef(false)
  const multiPVRef = useRef(lsLoadInt(LS_KEYS.multiPV, 1, 1))
  const analysisFenRef = useRef('')

  // Fetch initial engine state once. engine:ready handles the case where the
  // goroutine hasn't finished its handshake yet when this runs.
  useEffect(() => {
    API.getEngineState().then(s => {
      setIsReady(s.isReady)
      setAvailableEngines(s.availableEngines)
      setActiveEngineState(s.activeEngine)
      if (s.engineName) setEngineName(s.engineName)
      if (s.engineType) setEngineType(s.engineType)
    }).catch(() => {})
  }, [])

  // Subscribe to the engine:ready push event so the Start button enables as
  // soon as the Go goroutine completes the UCI handshake, regardless of when
  // the component mounted relative to that goroutine. The payload carries the
  // full EngineState so we also refresh the engine list and active engine.
  // Hash/Threads are now applied by the Go backend on launch.
  useEffect(() => {
    return EventsOn(READY_EVENT, (state?: { isReady?: boolean; activeEngine?: string; availableEngines?: EngineEntry[]; engineName?: string; engineType?: EngineType }) => {
      setIsReady(true)
      if (state?.availableEngines) setAvailableEngines(state.availableEngines)
      if (state?.activeEngine) setActiveEngineState(state.activeEngine)
      if (state?.engineName) setEngineName(state.engineName)
      if (state?.engineType) setEngineType(state.engineType)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to engine:engines-changed so the selector updates when engines
  // are added or removed on the Settings page without requiring a remount.
  // Primary slot only — secondary slot shares the same engine list.
  useEffect(() => {
    if (isSecondary) return
    return EventsOn('engine:engines-changed', (engines: EngineEntry[]) => {
      if (engines) setAvailableEngines(engines)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh available engine list when a download completes.
  // Primary slot only — secondary slot shares the same engine list.
  useEffect(() => {
    if (isSecondary) return
    return EventsOn('engine:download-complete', () => {
      api.getEngineState().then(s => {
        if (s.availableEngines) setAvailableEngines(s.availableEngines)
      }).catch(() => {})
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to engine:info events for the lifetime of the hook
  useEffect(() => {
    const unsubscribe = EventsOn(INFO_EVENT, (data: EngineInfo) => {
      if (!isAnalysingRef.current) return   // ignore stale events after stop
      if (data.pvUci.length === 0) return   // skip thread-sync lines with no PV
      if (data.multiPV > multiPVRef.current) return  // discard stale lines from previous multiPV setting
      startTransition(() => {
        setLines(prev => {
          const next = [...prev]
          next[data.multiPV - 1] = data
          // Truncate: if multiPV was lowered, stale trailing entries may linger
          // in the array from a previous render cycle.  Cap the length so the UI
          // never shows more lines than the current setting.
          const cap = multiPVRef.current
          if (next.length > cap) next.length = cap
          return next
        })
        setCurrentDepth(prev => Math.max(prev, data.depth))
      })
    })
    return unsubscribe
  }, [])

  // React to FEN changes while analysing.
  // Stop immediately to gate stale events, but debounce the restart so that
  // rapid arrow-key navigation doesn't trigger 30 stop/start cycles per second.
  const fenRestartRef = useRef<number>(0)
  const pendingRestartRef = useRef(false)

  useEffect(() => {
    // Always cancel any pending restart — FEN has changed again.
    clearTimeout(fenRestartRef.current)
    fenRestartRef.current = 0

    if (!isAnalysingRef.current && !pendingRestartRef.current) {
      return
    }

    if (isAnalysingRef.current) {
      isAnalysingRef.current = false // gate stale events during restart
      API.stopAnalysis().catch(() => {})
    }
    // Don't clear lines/depth/analysisFen here — keep showing the previous
    // analysis in the engine panel and eval bar until the engine restarts,
    // to avoid a jarring empty flash.

    // Debounce engine start — only analyse once navigation settles.
    // Lines are cleared atomically with the restart so the empty window is
    // just the few ms until the first engine info event arrives.
    pendingRestartRef.current = true
    fenRestartRef.current = window.setTimeout(() => {
      pendingRestartRef.current = false
      analysisFenRef.current = fen
      startTransition(() => {
        setAnalysisFen(fen)
        setLines([])
        setCurrentDepth(0)
      })
      isAnalysingRef.current = true
      API.startAnalysis(fen, multiPVRef.current).catch(() => {})
    }, 200)
  }, [fen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stop on unmount if still running
  useEffect(() => {
    return () => {
      clearTimeout(fenRestartRef.current)
      pendingRestartRef.current = false
      if (isAnalysingRef.current) {
        API.stopAnalysis().catch(() => {})
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startAnalysis = useCallback(() => {
    isAnalysingRef.current = true
    analysisFenRef.current = fen
    setIsAnalysing(true)
    setAnalysisFen(fen)
    startTransition(() => {
      setLines([])
      setCurrentDepth(0)
    })
    API.startAnalysis(fen, multiPVRef.current).catch(() => {})
  }, [fen]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopAnalysis = useCallback(() => {
    isAnalysingRef.current = false
    setIsAnalysing(false)
    startTransition(() => {
      setLines([])
      setCurrentDepth(0)
    })
    API.stopAnalysis().catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleArrows = useCallback(() => {
    setShowArrows(v => {
      const next = !v
      try { localStorage.setItem(LS.showArrows, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const setActiveEngine = useCallback((path: string) => {
    isAnalysingRef.current = false
    setIsAnalysing(false)
    setIsReady(false)
    startTransition(() => {
      setLines([])
      setCurrentDepth(0)
    })
    setActiveEngineState(path)
    API.setActiveEngine(path).catch(() => {})
    // isReady will be restored when the engine:ready event fires
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setMultiPV = useCallback((n: number) => {
    multiPVRef.current = n
    setMultiPVState(n)
    try { localStorage.setItem(LS_KEYS.multiPV, String(n)) } catch { /* ignore */ }
    startTransition(() => {
      setLines([])
      setCurrentDepth(0)
    })
    if (isAnalysingRef.current) {
      isAnalysingRef.current = false // gate stale events during restart
      API.stopAnalysis()
        .then(() => {
          isAnalysingRef.current = true
          return API.startAnalysis(analysisFenRef.current, n)
        })
        .catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { fen, isReady, isAnalysing, lines, currentDepth, analysisFen, multiPV, showArrows, availableEngines, activeEngine, engineName, engineType, startAnalysis, stopAnalysis, setMultiPV, toggleArrows, setActiveEngine }
}

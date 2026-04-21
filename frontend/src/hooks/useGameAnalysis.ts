import { useCallback, useEffect, useRef, useState } from 'react'
import { EventsOn } from '@/lib/wailsRuntime'
import { api, type GameAnalysisResult, type AnalysisProgress, type AnalysisComplete, type MoveEval, type DeviationResult } from '@/lib/api'

export interface GameAnalysisHook {
  isAnalysing: boolean
  progress: { ply: number; totalPlies: number } | null
  result: GameAnalysisResult | null
  deviationResult: DeviationResult | null
  setDeviationResult: (r: DeviationResult | null) => void
  refreshDeviation: (gameId: string) => Promise<void>
  startAnalysis: () => void
  cancelAnalysis: () => void | Promise<void>
  markAnnotated: (appliedEvals: MoveEval[]) => void
}

export function useGameAnalysis(gameId: string | null): GameAnalysisHook {
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [progress, setProgress] = useState<{ ply: number; totalPlies: number } | null>(null)
  const [result, setResult] = useState<GameAnalysisResult | null>(null)
  const [deviationResult, setDeviationResult] = useState<DeviationResult | null>(null)
  const gameIdRef = useRef(gameId)
  gameIdRef.current = gameId
  const cancelledRef = useRef(false)

  const refreshDeviation = useCallback(async (gid: string): Promise<void> => {
    try {
      const r = await api.detectDeviation(gid)
      setDeviationResult(r)
    } catch {
      setDeviationResult(null)
    }
  }, [])

  // Load existing analysis on mount or when gameId changes.
  // Always reset state first so switching games never leaks stale flags.
  useEffect(() => {
    setResult(null)
    setIsAnalysing(false)
    setProgress(null)
    setDeviationResult(null)
    if (!gameId) return

    api.getGameAnalysis(gameId).then((res) => {
      if (res && gameIdRef.current === gameId) {
        setResult(res)
        if (res.status === 'running') {
          setIsAnalysing(true)
        }
      }
    }).catch(() => {})

    api.detectDeviation(gameId).then((r) => {
      if (gameIdRef.current === gameId) setDeviationResult(r)
    }).catch(() => {})

  }, [gameId])

  // Listen for progress events.
  useEffect(() => {
    const unsub = EventsOn('analysis:progress', (data: AnalysisProgress) => {
      if (data.gameId === gameIdRef.current) {
        setProgress({ ply: data.ply, totalPlies: data.totalPlies })
      }
    })
    return unsub
  }, [])

  // Listen for completion events.
  useEffect(() => {
    const unsub = EventsOn('analysis:complete', (data: AnalysisComplete) => {
      if (data.gameId === gameIdRef.current) {
        setIsAnalysing(false)
        setProgress(null)
        // On any cancellation, fetch from DB — previous results may have been
        // restored if this was a re-analysis. getGameAnalysis returns null for
        // fresh analyses, leaving result cleared as expected.
        if (data.status === 'cancelled' || cancelledRef.current) {
          cancelledRef.current = false
          api.getGameAnalysis(data.gameId).then((res) => {
            if (gameIdRef.current === data.gameId) {
              setResult(res)
            }
          }).catch(() => {})
          return
        }
        // Surface errors immediately from the event payload without
        // relying on a DB fetch that might also fail.
        if (data.status === 'error') {
          setResult({
            gameId: data.gameId,
            depth: 0,
            whiteAccuracy: null,
            blackAccuracy: null,
            whiteAcpl: null,
            blackAcpl: null,
            status: 'error',
            errorMsg: data.errorMsg || 'Analysis failed',
            analysedAt: '',
            pgnAnnotated: false,
            evals: [],
            appliedEvals: [],
          })
          return
        }
        // Fetch the full results for successful completion.
        api.getGameAnalysis(data.gameId).then((res) => {
          if (res && gameIdRef.current === data.gameId) {
            setResult(res)
          }
        }).catch(() => {})
      }
    })
    return unsub
  }, [])

  const startAnalysis = useCallback(() => {
    if (!gameIdRef.current) return
    cancelledRef.current = false
    setIsAnalysing(true)
    setProgress(null)
    setResult(null)
    api.analyseGame(gameIdRef.current).catch(() => {
      setIsAnalysing(false)
    })
  }, [])

  const cancelAnalysis = useCallback(async () => {
    cancelledRef.current = true
    setIsAnalysing(false)
    setProgress(null)
    setResult(null)
    try {
      await api.cancelAnalysis()
    } catch {
      // swallow — UI state already reset
    }
  }, [])

  const markAnnotated = useCallback((appliedEvals: MoveEval[]) => {
    setResult(prev => prev ? { ...prev, pgnAnnotated: true, appliedEvals } : prev)
  }, [])

  return { isAnalysing, progress, result, deviationResult, setDeviationResult, refreshDeviation, startAnalysis, cancelAnalysis, markAnnotated }
}

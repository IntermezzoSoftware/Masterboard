import { useCallback, useEffect, useRef, useState } from 'react'
import { EventsOn } from '@/lib/wailsRuntime'
import {
  api,
  type MasterDBStatus,
  type MasterDBProgressEvent,
  type MasterDBCompleteEvent,
} from '@/lib/api'


/**
 * Estimates DB size and import duration for a given total game count.
 *
 * Benchmark basis (architecture.md):
 *   114k  games →  10.3 s,  253 MB  (~2.2 KB/game, ~11000 games/s)
 *   1.94M games → 170 s,  4.66 GB  (~2.5 KB/game)
 *   10.29M games → 4958 s, 22.3 GB  (~2.2 KB/game — super-linear B-tree scaling)
 *
 * Size:  2.3 KB per game (average across benchmarks)
 * Time:  linear up to 2M games (~11000/s); quadratic above (B-tree depth)
 */
export function estimateImport(totalGames: number): { seconds: number; dbSizeGB: number } {
  const dbSizeGB = (totalGames * 2300) / 1e9
  const seconds =
    totalGames <= 2000000
      ? totalGames / 11000
      : 182 * Math.pow(totalGames / 2000000, 2)
  return { seconds, dbSizeGB }
}

/**
 * Formats an import duration in seconds as a human-readable approximate string.
 * Examples: "< 1 min", "~3 min", "~1 hr 24 min", "~1 day 12 hrs"
 */
export function formatImportDuration(seconds: number): string {
  if (seconds < 60) return '< 1 min'
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 90) return `~${totalMinutes} min`
  const totalHours = Math.floor(seconds / 3600)
  const remainingMinutes = Math.round((seconds % 3600) / 60)
  if (totalHours < 48) {
    const hrPart = `${totalHours} hr${totalHours !== 1 ? 's' : ''}`
    return remainingMinutes > 0 ? `~${hrPart} ${remainingMinutes} min` : `~${hrPart}`
  }
  const days = Math.floor(seconds / 86400)
  const remainingHours = Math.round((seconds % 86400) / 3600)
  const dayPart = `${days} day${days !== 1 ? 's' : ''}`
  return remainingHours > 0 ? `~${dayPart} ${remainingHours} hrs` : `~${dayPart}`
}

type MasterDBUIState = 'not-configured' | 'importing' | 'indexed'

interface MasterFileInfo {
  name: string
  path: string
  sizeBytes: number
  estimatedGames: number
}

interface ImportProgress {
  gamesProcessed: number
  currentFile: string
  fileIndex: number
  totalFiles: number
  phase: string // "processing" | "building-stats" | "building-index" | "optimizing"
  phaseDone: number
  phaseTotal: number
  estimatedTotalGames: number // sum of file-size estimates, used for processing phase bar
}

interface UseMasterDBResult {
  uiState: MasterDBUIState
  status: MasterDBStatus | null
  progress: ImportProgress | null
  selectedFiles: MasterFileInfo[]
  selectFiles: () => Promise<void>
  startImport: (replace: boolean) => Promise<void>
  cancelImport: () => Promise<void>
  clearDB: () => Promise<void>
  dbExists: boolean
}

export function useMasterDB(): UseMasterDBResult {
  const [uiState, setUIState] = useState<MasterDBUIState>('not-configured')
  const [status, setStatus] = useState<MasterDBStatus | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<MasterFileInfo[]>([])
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  // Keep a ref to the current status so event callbacks can read the latest value.
  const statusRef = useRef<MasterDBStatus | null>(null)
  statusRef.current = status
  // Estimated total games (from file sizes), set at startImport and read by event handler.
  const estimatedTotalRef = useRef(0)

  // Load initial status on mount.
  useEffect(() => {
    api.getMasterDBStatus()
      .then(s => {
        setStatus(s)
        if (s.importing) setUIState('importing')
        else if (s.state === 'indexed') setUIState('indexed')
      })
      .catch(() => {})
  }, [])

  // Subscribe to progress and complete events.
  useEffect(() => {
    const unsubProgress = EventsOn('masterdb:progress', (payload: MasterDBProgressEvent) => {
      setUIState('importing')
      setProgress({
        gamesProcessed: payload.gamesProcessed,
        currentFile: payload.currentFile,
        fileIndex: payload.fileIndex,
        totalFiles: payload.totalFiles,
        phase: payload.phase || 'processing',
        phaseDone: payload.phaseDone ?? 0,
        phaseTotal: payload.phaseTotal ?? 0,
        estimatedTotalGames: estimatedTotalRef.current,
      })
    })

    const unsubComplete = EventsOn('masterdb:complete', (payload: MasterDBCompleteEvent) => {
      setProgress(null)
      setSelectedFiles([])
      if (payload.success) {
        api.getMasterDBStatus()
          .then(s => {
            setStatus(s)
            setUIState('indexed')
          })
          .catch(() => setUIState('indexed'))
      } else {
        // Cancelled or error — restore prior state.
        const prior = statusRef.current
        setUIState(prior?.state === 'indexed' ? 'indexed' : 'not-configured')
      }
    })

    return () => {
      unsubProgress()
      unsubComplete()
    }
  }, [])

  const selectFiles = useCallback(async () => {
    const paths = await api.openMasterDBFileDialog()
    if (!paths || paths.length === 0) return
    const sizes = await api.getFileSizes(paths)
    const files: MasterFileInfo[] = paths.map((p, i) => ({
      name: p.split(/[/\\]/).pop() ?? p,
      path: p,
      sizeBytes: sizes[i] ?? 0,
      estimatedGames: Math.round((sizes[i] ?? 0) / 500),
    }))
    setSelectedFiles(files)
  }, [])

  const startImport = useCallback(async (replace: boolean) => {
    if (selectedFiles.length === 0) return
    const estimated = selectedFiles.reduce((sum, f) => sum + f.estimatedGames, 0)
    estimatedTotalRef.current = estimated
    setUIState('importing')
    setProgress({
      gamesProcessed: 0,
      currentFile: selectedFiles[0]?.name ?? '',
      fileIndex: 1,
      totalFiles: selectedFiles.length,
      phase: 'processing',
      phaseDone: 0,
      phaseTotal: 0,
      estimatedTotalGames: estimated,
    })
    await api.startMasterDBImport(selectedFiles.map(f => f.path), replace)
  }, [selectedFiles])

  const cancelImport = useCallback(async () => {
    await api.cancelMasterDBImport()
  }, [])

  const clearDB = useCallback(async () => {
    await api.clearMasterDB()
    setStatus(null)
    setSelectedFiles([])
    setProgress(null)
    setUIState('not-configured')
  }, [])

  return {
    uiState,
    status,
    progress,
    selectedFiles,
    selectFiles,
    startImport,
    cancelImport,
    clearDB,
    dbExists: status?.state === 'indexed',
  }
}

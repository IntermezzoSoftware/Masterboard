import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { estimateImport, formatImportDuration, useMasterDB } from './useMasterDB'


const mockEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

vi.mock('@/lib/wailsRuntime', () => ({
  EventsOn: vi.fn((event: string, cb: (payload: unknown) => void) => {
    mockEventHandlers.set(event, cb)
    return () => mockEventHandlers.delete(event)
  }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    getMasterDBStatus: vi.fn(),
    openMasterDBFileDialog: vi.fn(),
    getFileSizes: vi.fn(),
    startMasterDBImport: vi.fn(),
    cancelMasterDBImport: vi.fn(),
    clearMasterDB: vi.fn(),
  },
}))


describe('estimateImport', () => {
  it('calculates db size correctly', () => {
    const { dbSizeGB } = estimateImport(1000000)
    expect(dbSizeGB).toBeCloseTo(2.3, 1)
  })

  it('uses linear time estimate up to 2M games', () => {
    const { seconds } = estimateImport(1100000)
    expect(seconds).toBeCloseTo(1100000 / 11000, 0)
  })

  it('uses quadratic time estimate above 2M games', () => {
    const { seconds: linear } = estimateImport(2000000)
    const { seconds: above } = estimateImport(4000000)
    // Quadratic: doubling games should more than double the time
    expect(above).toBeGreaterThan(linear * 2)
  })

  it('returns zero size for zero games', () => {
    const { dbSizeGB, seconds } = estimateImport(0)
    expect(dbSizeGB).toBe(0)
    expect(seconds).toBe(0)
  })

  it('returns small values for small game counts', () => {
    const { dbSizeGB } = estimateImport(114000)
    expect(dbSizeGB).toBeCloseTo(0.262, 1)
  })
})


describe('formatImportDuration', () => {
  it('returns "< 1 min" for less than 60 seconds', () => {
    expect(formatImportDuration(0)).toBe('< 1 min')
    expect(formatImportDuration(30)).toBe('< 1 min')
    expect(formatImportDuration(59)).toBe('< 1 min')
  })

  it('returns minutes for 60–89 total minutes', () => {
    expect(formatImportDuration(60)).toBe('~1 min')
    expect(formatImportDuration(180)).toBe('~3 min')
    expect(formatImportDuration(5340)).toBe('~89 min')
  })

  it('returns hours and minutes for >= 90 minutes', () => {
    // 5400s = 90 min → first value that hits the hours path
    expect(formatImportDuration(5400)).toBe('~1 hr 30 min')
    // 7200s = 120 min, no remainder
    expect(formatImportDuration(7200)).toBe('~2 hrs')
    // 9000s = 150 min → 2 hr 30 min
    expect(formatImportDuration(9000)).toBe('~2 hrs 30 min')
    // 3600s = 60 min < 90 → stays in the minutes path
    expect(formatImportDuration(3600)).toBe('~60 min')
  })

  it('returns days for >= 48 hours', () => {
    // 86400 * 2 = 172800s → exactly 48 hours → days path
    expect(formatImportDuration(86400 * 2)).toBe('~2 days')
    // 86400 * 3 = 259200s → 3 days no remainder
    expect(formatImportDuration(86400 * 3)).toBe('~3 days')
    // 86400 * 1.5 = 129600s → only 36 hrs → still in hours path (< 48)
    expect(formatImportDuration(86400 * 1.5)).toBe('~36 hrs')
  })
})


describe('useMasterDB', () => {
  beforeEach(async () => {
    mockEventHandlers.clear()
    const { api } = await import('@/lib/api')
    vi.mocked(api.getMasterDBStatus).mockResolvedValue({ state: 'not-configured', importing: false })
    vi.mocked(api.startMasterDBImport).mockResolvedValue(undefined)
    vi.mocked(api.cancelMasterDBImport).mockResolvedValue(undefined)
    vi.mocked(api.clearMasterDB).mockResolvedValue(undefined)
  })

  it('starts with not-configured state', async () => {
    const { result } = renderHook(() => useMasterDB())
    expect(result.current.uiState).toBe('not-configured')
    expect(result.current.status).toBeNull()
  })

  it('transitions to indexed when status is indexed', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getMasterDBStatus).mockResolvedValue({ state: 'indexed', importing: false })
    const { result } = renderHook(() => useMasterDB())
    await waitFor(() => expect(result.current.uiState).toBe('indexed'))
    expect(result.current.dbExists).toBe(true)
  })

  it('clears state on clearDB', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getMasterDBStatus).mockResolvedValue({ state: 'indexed', importing: false })
    const { result } = renderHook(() => useMasterDB())
    await waitFor(() => expect(result.current.uiState).toBe('indexed'))

    await act(async () => { await result.current.clearDB() })

    expect(result.current.uiState).toBe('not-configured')
    expect(result.current.status).toBeNull()
    expect(result.current.progress).toBeNull()
  })

  it('transitions to importing on progress event', async () => {
    const { result } = renderHook(() => useMasterDB())
    await waitFor(() => expect(result.current.uiState).toBe('not-configured'))

    act(() => {
      const handler = mockEventHandlers.get('masterdb:progress')
      handler?.({
        gamesProcessed: 500,
        currentFile: 'games.pgn',
        fileIndex: 1,
        totalFiles: 1,
        phase: 'processing',
        phaseDone: 500,
        phaseTotal: 1000,
      })
    })

    expect(result.current.uiState).toBe('importing')
    expect(result.current.progress?.gamesProcessed).toBe(500)
    expect(result.current.progress?.currentFile).toBe('games.pgn')
  })

  it('transitions to indexed on successful complete event', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getMasterDBStatus).mockResolvedValue({ state: 'indexed', importing: false })
    const { result } = renderHook(() => useMasterDB())

    await act(async () => {
      const handler = mockEventHandlers.get('masterdb:complete')
      handler?.({ success: true })
    })

    await waitFor(() => expect(result.current.uiState).toBe('indexed'))
    expect(result.current.progress).toBeNull()
  })

  it('restores prior state on cancelled import', async () => {
    const { result } = renderHook(() => useMasterDB())
    await waitFor(() => expect(result.current.uiState).toBe('not-configured'))

    act(() => {
      const handler = mockEventHandlers.get('masterdb:complete')
      handler?.({ success: false })
    })

    expect(result.current.uiState).toBe('not-configured')
  })
})

import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockDecodeAudioData = vi.fn()
const mockCreateBufferSource = vi.fn()
const mockConnect = vi.fn()
const mockStart = vi.fn()
const mockResume = vi.fn().mockResolvedValue(undefined)

const mockSource = {
  buffer: null as AudioBuffer | null,
  connect: mockConnect,
  start: mockStart,
}

const mockAudioContext = {
  state: 'running' as AudioContextState,
  decodeAudioData: mockDecodeAudioData,
  createBufferSource: mockCreateBufferSource,
  resume: mockResume,
  destination: {},
}

const mockBuffer = { duration: 0.1 } as unknown as AudioBuffer

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()

  mockDecodeAudioData.mockResolvedValue(mockBuffer)
  mockCreateBufferSource.mockReturnValue(mockSource)

  vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  }))
})

describe('playMoveSound', () => {
  it('fetches /sounds/Move.ogg and plays the buffer', async () => {
    const { playMoveSound } = await import('./soundManager')
    playMoveSound()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith('/sounds/Move.ogg')
    expect(mockCreateBufferSource).toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalled()
  })

  it('does not re-fetch on second call (buffer cached)', async () => {
    const { playMoveSound } = await import('./soundManager')
    playMoveSound()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    playMoveSound()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not play when sound is disabled', async () => {
    const { playMoveSound, setSoundEnabled } = await import('./soundManager')
    setSoundEnabled(false)
    playMoveSound()
    await Promise.resolve()
    await Promise.resolve()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('retries fetch after a failed load', async () => {
    let rejectFirst!: (e: Error) => void
    const firstFetchPromise = new Promise<never>((_, reject) => { rejectFirst = reject })
    const mockFetch = vi.fn()
      .mockReturnValueOnce(firstFetchPromise)
      .mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      })
    mockDecodeAudioData.mockResolvedValueOnce({} as AudioBuffer)
    vi.stubGlobal('fetch', mockFetch)

    const { playMoveSound } = await import('./soundManager')
    playMoveSound()
    // reject the first fetch and flush the microtask queue so pendingLoads is cleared
    // (the catch is 4 promise hops deep, so flush enough microtask ticks)
    rejectFirst(new Error('network'))
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // second call should trigger a new fetch since the key was removed from pendingLoads
    playMoveSound()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  })
})

describe('playCaptureSound', () => {
  it('fetches /sounds/Capture.ogg', async () => {
    const { playCaptureSound } = await import('./soundManager')
    playCaptureSound()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith('/sounds/Capture.ogg')
  })
})

describe('setSoundEnabled / isSoundEnabled', () => {
  it('persists enabled state to localStorage', async () => {
    const { setSoundEnabled, isSoundEnabled } = await import('./soundManager')
    setSoundEnabled(false)
    expect(localStorage.getItem('masterboard-soundEnabled')).toBe('false')
    expect(isSoundEnabled()).toBe(false)
    setSoundEnabled(true)
    expect(localStorage.getItem('masterboard-soundEnabled')).toBe('true')
    expect(isSoundEnabled()).toBe(true)
  })
})

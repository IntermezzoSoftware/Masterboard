let ctx: AudioContext | null = null
let enabled = localStorage.getItem('masterboard-soundEnabled') !== 'false'

const bufferCache = new Map<string, AudioBuffer>()
const pendingLoads = new Map<string, Promise<AudioBuffer | null>>()

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function loadBuffer(key: string, path: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = pendingLoads.get(key)
  if (pending) return pending

  const ac = getCtx()
  const p = fetch(path)
    .then(r => r.arrayBuffer())
    .then(ab => ac.decodeAudioData(ab))
    .then(buf => { bufferCache.set(key, buf); pendingLoads.delete(key); return buf })
    .catch(() => { pendingLoads.delete(key); return null })
  pendingLoads.set(key, p)
  return p
}

function play(buffer: AudioBuffer | null): void {
  if (!enabled || !buffer) return
  const ac = getCtx()
  if (ac.state === 'suspended') ac.resume().catch(() => {})
  const source = ac.createBufferSource()
  source.buffer = buffer
  source.connect(ac.destination)
  source.start()
}

export function playMoveSound(): void {
  loadBuffer('move', '/sounds/Move.ogg').then(play).catch(() => {})
}

export function playCaptureSound(): void {
  loadBuffer('capture', '/sounds/Capture.ogg').then(play).catch(() => {})
}

export function setSoundEnabled(on: boolean): void {
  enabled = on
  localStorage.setItem('masterboard-soundEnabled', on ? 'true' : 'false')
}

export function isSoundEnabled(): boolean {
  return enabled
}

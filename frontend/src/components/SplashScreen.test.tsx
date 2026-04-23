import { render, screen, act } from '@testing-library/react'
import type { ComponentType } from 'react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// vi.hoisted so the ref is available inside the hoisted vi.mock factory
const { appReadyRef } = vi.hoisted(() => {
  const appReadyRef = { current: null as (() => void) | null }
  return { appReadyRef }
})

vi.mock('@/lib/wailsRuntime', () => ({
  EventsOn: vi.fn((event: string, cb: () => void) => {
    if (event === 'app:ready') appReadyRef.current = cb
    return vi.fn() // unsubscribe
  }),
}))

vi.mock('@/assets/logo-full.svg?raw', () => ({
  default: '<svg data-testid="logo-svg"></svg>',
}))

// Stub localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })

// SplashScreen registers EventsOn at module load time (not in useEffect), so
// _appReadyFired/_appReadyQueue are module-level state. Re-import via
// vi.isolateModules each test to get a fresh module with clean state.
let SplashScreen: ComponentType<{ onDone: () => void; onExiting?: () => void }>

describe('SplashScreen', () => {
  beforeEach(async () => {
    appReadyRef.current = null
    localStorageMock.clear()
    vi.resetModules()
    const mod = await import('./SplashScreen')
    SplashScreen = mod.default
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the logo and overlay', () => {
    render(<SplashScreen onDone={vi.fn()} />)
    expect(screen.getByTestId('splash-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('logo-svg')).toBeInTheDocument()
  })

  it('does not call onDone before min timer and app:ready', () => {
    const onDone = vi.fn()
    render(<SplashScreen onDone={onDone} />)
    act(() => { vi.advanceTimersByTime(1749) })
    appReadyRef.current?.()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('calls onDone after both min timer and app:ready', () => {
    const onDone = vi.fn()
    render(<SplashScreen onDone={onDone} />)
    act(() => { vi.advanceTimersByTime(1750) })
    act(() => { appReadyRef.current?.() })
    // onDone fires after exit animation (850ms)
    act(() => { vi.advanceTimersByTime(850) })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('waits for app:ready even after min timer elapses', () => {
    const onDone = vi.fn()
    render(<SplashScreen onDone={onDone} />)
    act(() => { vi.advanceTimersByTime(3000) }) // well past min
    expect(onDone).not.toHaveBeenCalled() // app:ready not fired yet
    act(() => { appReadyRef.current?.() })
    act(() => { vi.advanceTimersByTime(850) })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('calls onExiting before onDone when exit begins', () => {
    const onDone = vi.fn()
    const onExiting = vi.fn()
    render(<SplashScreen onDone={onDone} onExiting={onExiting} />)
    act(() => { vi.advanceTimersByTime(1750) })
    act(() => { appReadyRef.current?.() })
    expect(onExiting).toHaveBeenCalledOnce()
    expect(onDone).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(850) })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('uses dark background when theme is dark', () => {
    localStorageMock.setItem('masterboard-theme', 'dark')
    render(<SplashScreen onDone={vi.fn()} />)
    const overlay = screen.getByTestId('splash-overlay')
    expect(overlay).toHaveStyle({ background: '#111213' })
  })

  it('uses light background when theme is light', () => {
    localStorageMock.setItem('masterboard-theme', 'light')
    render(<SplashScreen onDone={vi.fn()} />)
    const overlay = screen.getByTestId('splash-overlay')
    expect(overlay).toHaveStyle({ background: '#fafafa' })
  })
})

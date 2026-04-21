import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import SplashScreen from './SplashScreen'

// Capture the app:ready listener so tests can fire it manually
let appReadyListener: (() => void) | null = null

vi.mock('@/lib/wailsRuntime', () => ({
  EventsOn: vi.fn((event: string, cb: () => void) => {
    if (event === 'app:ready') appReadyListener = cb
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

describe('SplashScreen', () => {
  beforeEach(() => {
    appReadyListener = null
    localStorageMock.clear()
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
    appReadyListener?.()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('calls onDone after both min timer and app:ready', () => {
    const onDone = vi.fn()
    render(<SplashScreen onDone={onDone} />)
    act(() => { vi.advanceTimersByTime(1750) })
    act(() => { appReadyListener?.() })
    // onDone fires after exit animation (850ms)
    act(() => { vi.advanceTimersByTime(850) })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('waits for app:ready even after min timer elapses', () => {
    const onDone = vi.fn()
    render(<SplashScreen onDone={onDone} />)
    act(() => { vi.advanceTimersByTime(3000) }) // well past min
    expect(onDone).not.toHaveBeenCalled() // app:ready not fired yet
    act(() => { appReadyListener?.() })
    act(() => { vi.advanceTimersByTime(850) })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('calls onExiting before onDone when exit begins', () => {
    const onDone = vi.fn()
    const onExiting = vi.fn()
    render(<SplashScreen onDone={onDone} onExiting={onExiting} />)
    act(() => { vi.advanceTimersByTime(1750) })
    act(() => { appReadyListener?.() })
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

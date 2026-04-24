import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { ThemeProvider } from '@/context/ThemeContext'
import AppLayout from './AppLayout'

vi.mock('@/hooks/useEngineAnalysis', () => ({
  useEngineAnalysis: vi.fn().mockReturnValue({
    isAnalysing: false, isReady: false, lines: [], currentDepth: 0,
    analysisFen: '', multiPV: 1,
    startAnalysis: vi.fn(), stopAnalysis: vi.fn(), setMultiPV: vi.fn(),
  }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, getPlatform: vi.fn().mockResolvedValue('windows') } }
})

vi.mock('@/lib/wailsRuntime', () => ({
  EventsOn: vi.fn().mockReturnValue(() => {}),
  WindowMinimise: vi.fn(),
  WindowToggleMaximise: vi.fn(),
  WindowIsMaximised: vi.fn().mockResolvedValue(false),
  WindowIsFullscreen: vi.fn().mockResolvedValue(false),
  Quit: vi.fn(),
}))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

function renderLayout() {
  const router = createMemoryRouter(
    [{ path: '/', element: <AppLayout />, children: [{ index: true, element: <div>outlet content</div> }] }],
    { initialEntries: ['/'] }
  )
  return render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>)
}

describe('AppLayout', () => {
  it('renders without crashing', () => {
    renderLayout()
    expect(screen.getByRole('img', { name: 'Masterboard' })).toBeInTheDocument()
  })

  it('renders all nav links', () => {
    renderLayout()
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Games' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Openings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders the Outlet child content', () => {
    renderLayout()
    expect(screen.getByText('outlet content')).toBeInTheDocument()
  })

  it('renders the theme toggle button', () => {
    renderLayout()
    expect(screen.getByRole('button', { name: /switch to/i })).toBeInTheDocument()
  })
})

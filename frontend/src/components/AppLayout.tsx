import { useState } from 'react'
import { Outlet } from 'react-router'
import { Grid3x3, Library, GitBranch, Settings, BarChart2, Target, ClipboardList, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { ChessGameProvider, useChessGameContext } from '@/context/ChessGameContext'
import { EngineProvider } from '@/context/EngineContext'
import { EngineFenOverrideProvider, useEngineFenOverride } from '@/context/EngineFenOverride'
import { AnalysisProvider } from '@/context/AnalysisContext'
import { ToastProvider } from '@/context/ToastContext'
import { TitlebarProvider } from '@/context/TitlebarContext'
import NavItem from './NavItem'
import Titlebar from './Titlebar'
import Toaster from './Toaster'
import BatchAnalysisStatus from './BatchAnalysisStatus'
import BoardStateGuardModal from './BoardStateGuardModal'
import UpdateBanner from './UpdateBanner'

function EngineProviderBridge({ children }: { children: React.ReactNode }) {
  const { currentNode, navigateToPV } = useChessGameContext()
  const { fen: overrideFen } = useEngineFenOverride()
  const fen = overrideFen ?? currentNode.fen
  return <EngineProvider fen={fen} navigateToPV={overrideFen ? undefined : navigateToPV}>{children}</EngineProvider>
}

function AnalysisProviderBridge({ children }: { children: React.ReactNode }) {
  const { savedGameId } = useChessGameContext()
  return <AnalysisProvider gameId={savedGameId}>{children}</AnalysisProvider>
}

const NAV_ITEMS = [
  { to: '/board',      icon: Grid3x3,       label: 'Home'       },
  { to: '/games',      icon: Library,       label: 'Games'      },
  { to: '/openings',   icon: GitBranch,     label: 'Openings'   },
  { to: '/tactics',    icon: Target,        label: 'Tactics'    },
  { to: '/statistics', icon: BarChart2,     label: 'Statistics' },
  { to: '/reports',    icon: ClipboardList, label: 'Reports'    },
  { to: '/settings',   icon: Settings,      label: 'Settings'   },
] as const

export default function AppLayout() {
  const { theme, toggleTheme } = useTheme()
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('nav-collapsed') === 'true' } catch { return false }
  })

  const toggleNav = () => {
    setNavCollapsed(c => {
      const next = !c
      try { localStorage.setItem('nav-collapsed', String(next)) } catch {}
      return next
    })
  }

  const sidebarWidth = navCollapsed ? '3.5rem' : '11rem'

  return (
    <TitlebarProvider>
    <div
      className="flex flex-col h-full bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]"
      style={{ '--sidebar-width': sidebarWidth } as React.CSSProperties}
    >
      <UpdateBanner />
      <Titlebar navCollapsed={navCollapsed} />
      <div className="flex flex-1 overflow-hidden">
        <aside
          aria-label="Main navigation"
          className={[
            'relative flex flex-col shrink-0 border-r border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] transition-[width] duration-200 overflow-hidden',
            navCollapsed ? 'w-14' : 'w-44',
          ].join(' ')}
        >
          {/* Half-pill collapse toggle — flush against the right border */}
          <button
            onClick={toggleNav}
            aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={navCollapsed ? 'Expand' : 'Collapse'}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-4 h-8 rounded-tl-[var(--radius-md)] rounded-bl-[var(--radius-md)] border border-r-0 border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors cursor-pointer"
          >
            {navCollapsed
              ? <ChevronRight size={10} strokeWidth={2} aria-hidden="true" />
              : <ChevronLeft  size={10} strokeWidth={2} aria-hidden="true" />
            }
          </button>
          {/* Nav links */}
          <nav className="flex-1 flex flex-col gap-1 px-2 py-3">
            {NAV_ITEMS.map(item => (
              <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} collapsed={navCollapsed} />
            ))}
          </nav>

          {/* Batch analysis status + cancel */}
          <BatchAnalysisStatus />

          {/* Theme toggle */}
          <div className="px-2 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              title={navCollapsed ? (theme === 'light' ? 'Dark mode' : 'Light mode') : undefined}
              className="flex w-full items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] text-sm font-medium overflow-hidden text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-all duration-150 cursor-pointer"
            >
              {theme === 'light'
                ? <Moon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                : <Sun  size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
              }
              <span className={navCollapsed ? 'max-w-0 overflow-hidden whitespace-nowrap' : 'whitespace-nowrap'}>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto h-full">
          <ToastProvider>
            <ChessGameProvider>
              <EngineFenOverrideProvider>
                <EngineProviderBridge>
                  <AnalysisProviderBridge>
                    <Outlet />
                    <BoardStateGuardModal />
                  </AnalysisProviderBridge>
                </EngineProviderBridge>
              </EngineFenOverrideProvider>
            </ChessGameProvider>
            <Toaster />
          </ToastProvider>
        </main>
      </div>
    </div>
    </TitlebarProvider>
  )
}

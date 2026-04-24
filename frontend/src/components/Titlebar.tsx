import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router'
import { Minus, Square, Copy, X, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { WindowMinimise, WindowToggleMaximise, WindowIsMaximised, WindowIsFullscreen, Quit } from '@/lib/wailsRuntime'
import { useTitlebar, useToolbarPortalRef, useToolbarLeftPortalRef, type BreadcrumbSegment } from '@/context/TitlebarContext'
import { useTheme } from '@/context/ThemeContext'

function ColourCircle({ colour }: { colour: 'white' | 'black' }) {
  return (
    <span
      aria-label={`${colour} repertoire`}
      className={[
        'inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-gray-500 dark:border-gray-400',
        colour === 'white' ? 'bg-white' : 'bg-neutral-900',
      ].join(' ')}
    />
  )
}

function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  if (segments.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="titlebar-no-drag flex items-center gap-1 text-xs font-medium min-w-0">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1
        return (
          <BreadcrumbSegmentItem key={i} seg={seg} isFirst={i === 0} isLast={isLast} />
        )
      })}
    </nav>
  )
}

function BreadcrumbSegmentItem({ seg, isFirst, isLast }: { seg: BreadcrumbSegment; isFirst: boolean; isLast: boolean }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const spanRef = useRef<HTMLSpanElement>(null)
  const [title, setTitle] = useState<string | undefined>(undefined)
  const activeRef = (seg.to && !isLast) ? linkRef : spanRef

  useEffect(() => {
    const el = activeRef.current
    if (!el) return
    const check = () => setTitle(el.scrollWidth > el.clientWidth ? seg.label : undefined)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [seg.label, activeRef])

  return (
    <span className="flex items-center gap-1 min-w-0">
      {!isFirst && (
        <ChevronRight size={10} className="shrink-0 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]" aria-hidden="true" />
      )}
      {seg.colourCircle && <ColourCircle colour={seg.colourCircle} />}
      {seg.to && !isLast ? (
        <Link
          ref={linkRef}
          to={seg.to}
          title={title}
          className="text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors truncate"
        >
          {seg.label}
        </Link>
      ) : (
        <span
          ref={spanRef}
          title={title}
          className="text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] truncate"
        >
          {seg.label}
        </span>
      )}
    </span>
  )
}

export default function Titlebar({ navCollapsed }: { navCollapsed?: boolean }) {
  const [platform, setPlatform] = useState<string>('windows')
  const [maximised, setMaximised] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const { breadcrumb, setCompact } = useTitlebar()
  const { theme } = useTheme()
  const ctxToolbarRef     = useToolbarPortalRef()
  const ctxToolbarLeftRef = useToolbarLeftPortalRef()
  const titlebarRootRef = useRef<HTMLDivElement>(null)
  const leftSectionRef  = useRef<HTMLDivElement>(null)
  const controlsRef     = useRef<HTMLDivElement>(null)
  const leftPortalEl    = useRef<HTMLElement | null>(null)
  const rightPortalEl   = useRef<HTMLElement | null>(null)

  // Combined callback refs so we can observe portal elements directly while
  // still registering them in TitlebarContext for portal rendering.
  const toolbarLeftRef = useCallback((el: HTMLDivElement | null) => {
    leftPortalEl.current = el
    ctxToolbarLeftRef(el)
  }, [ctxToolbarLeftRef])

  const toolbarRef = useCallback((el: HTMLDivElement | null) => {
    rightPortalEl.current = el
    ctxToolbarRef(el)
  }, [ctxToolbarRef])

  // Compact-mode detection — static calculation, no feedback loop.
  //
  // "Natural width" = the space both portal slots need at full (non-compact) size.
  // We read scrollWidth (intrinsic content width, unaffected by overflow clipping)
  // only while compact=false, then cache it. Available space = titlebar outer width
  // minus the fixed left section (mark + breadcrumb) minus the window controls.
  //
  // Because naturalWidth is only updated when compact=false, toggling compact does
  // not affect the cached value → no feedback loop, no rAF, no hysteresis counters.
  useEffect(() => {
    const titlebar = titlebarRootRef.current
    if (!titlebar) return

    let isCompact    = false
    let naturalWidth = 0

    const ro = new ResizeObserver(() => {
      // Update natural width only while in non-compact mode (buttons are full size).
      if (!isCompact) {
        naturalWidth = (leftPortalEl.current?.scrollWidth  ?? 0)
                     + (rightPortalEl.current?.scrollWidth ?? 0)
      }

      const available = titlebar.offsetWidth
                      - (leftSectionRef.current?.offsetWidth  ?? 0)
                      - (controlsRef.current?.offsetWidth ?? 0)

      // Hysteresis: enter compact 8 px before overflow, exit only once there is 24 px of
      // breathing room. The asymmetric band (entry −8, exit −24) serves two purposes:
      //   1. The 8 px entry lead gives React one frame to commit before the portals
      //      actually reach zero spacer, hiding the pre-commit render.
      //   2. The 16 px dead band between entry and exit prevents oscillation — once
      //      compact, the exit condition can never be satisfied by the entry event alone.
      const shouldBeCompact = isCompact
        ? naturalWidth > available - 24     // exit: need 24 px of free space first
        : naturalWidth > available - 8      // entry: fire 8 px before overflow

      if (shouldBeCompact !== isCompact) {
        isCompact = shouldBeCompact
        setCompact(shouldBeCompact)
      }
    })

    ro.observe(titlebar)                                           // window resize
    if (leftPortalEl.current)  ro.observe(leftPortalEl.current)   // page nav (content added/removed)
    if (rightPortalEl.current) ro.observe(rightPortalEl.current)  // page nav (content added/removed)
    return () => ro.disconnect()
  }, [setCompact])

  useEffect(() => {
    api.getPlatform().then(setPlatform).catch(() => {})
  }, [])

  // Poll maximised + fullscreen state (Wails v2 has no window-state-change event).
  useEffect(() => {
    const poll = setInterval(() => {
      WindowIsMaximised().then(setMaximised).catch(() => {})
      WindowIsFullscreen().then(setFullscreen).catch(() => {})
    }, 500)
    return () => clearInterval(poll)
  }, [])

  const handleToggleMaximise = useCallback(() => {
    WindowToggleMaximise()
    setMaximised(m => !m)
  }, [])

  const showControls = platform !== 'darwin'

  return (
    <div
      ref={titlebarRootRef}
      data-testid="titlebar"
      onDoubleClick={handleToggleMaximise}
      className="titlebar-drag flex items-center h-10 shrink-0 bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] select-none"
    >
      {/* Left: mark + breadcrumb — fixed width matching sidebar. On macOS we
          push the inner content right by the width of the native traffic-light
          buttons (~70 px) so the mark doesn't sit under them; the section
          still occupies `--sidebar-width` so every portal / spacer to its
          right keeps the same alignment as on Windows/Linux. In fullscreen
          the traffic lights auto-hide, so collapse the inset back to 20 px. */}
      <div
        ref={leftSectionRef}
        className="flex items-center gap-2 min-w-0 overflow-hidden shrink-0 transition-[width,padding] duration-200"
        style={{ width: 'var(--sidebar-width)', paddingLeft: platform === 'darwin' && !fullscreen ? 90 : 20 }}
      >
        <img
          src={theme === 'dark' ? '/mark-dark.png' : '/mark-light.png'}
          alt="Masterboard"
          className="h-5 shrink-0"
          draggable={false}
        />
        {!navCollapsed && breadcrumb.length > 0 && <Breadcrumb segments={breadcrumb} />}
      </div>

      {/* Left-aligned per-page toolbar content */}
      <div ref={toolbarLeftRef} className="titlebar-no-drag flex items-center gap-1 pl-2 shrink-0 pointer-events-none [&>*]:pointer-events-auto" />

      {/* Spacer */}
      <div className="flex-1 h-full" />

      {/* Right-aligned per-page toolbar content (portal target). On macOS there
          are no window controls to the right, so add a small inset to keep the
          last button clear of the rounded corner. */}
      <div
        ref={toolbarRef}
        className="titlebar-no-drag flex items-center gap-1 shrink-0"
        style={{ paddingRight: platform === 'darwin' ? 12 : 0 }}
      />

      {/* Right: window controls — pl-2 provides the gap between the right portal and the
          first control button; keeping it here (rather than mr-2 on the portal) ensures
          the gap is included in controlsRef.offsetWidth and therefore in the available-space
          calculation used by the compact-mode detector. */}
      {showControls && (
        <div ref={controlsRef} className="titlebar-no-drag flex items-center h-full shrink-0 pl-2">
          <button
            aria-label="Minimize"
            onClick={WindowMinimise}
            className="flex items-center justify-center w-11 h-full text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
          >
            <Minus size={14} strokeWidth={1.5} />
          </button>
          <button
            aria-label={maximised ? 'Restore' : 'Maximize'}
            onClick={handleToggleMaximise}
            className="flex items-center justify-center w-11 h-full text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
          >
            {maximised
              ? <Copy size={12} strokeWidth={1.5} />
              : <Square size={12} strokeWidth={1.5} />
            }
          </button>
          <button
            aria-label="Close"
            onClick={() => Quit()}
            className="flex items-center justify-center w-11 h-full text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition-colors"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  )
}

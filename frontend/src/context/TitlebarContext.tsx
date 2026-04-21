import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface BreadcrumbSegment {
  label: string
  to?: string
  colourCircle?: 'white' | 'black'
}

interface TitlebarContextValue {
  breadcrumb: BreadcrumbSegment[]
  setBreadcrumb: (segments: BreadcrumbSegment[]) => void
  toolbarPortalTarget: HTMLElement | null
  setToolbarPortalTarget: (el: HTMLElement | null) => void
  toolbarLeftPortalTarget: HTMLElement | null
  setToolbarLeftPortalTarget: (el: HTMLElement | null) => void
  /** True when the spacer between toolbars has collapsed, meaning buttons should show icons only. */
  compact: boolean
  setCompact: (v: boolean) => void
}

const TitlebarContext = createContext<TitlebarContextValue | null>(null)

export function TitlebarProvider({ children }: { children: ReactNode }) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbSegment[]>([])
  const [toolbarPortalTarget, setToolbarPortalTarget] = useState<HTMLElement | null>(null)
  const [toolbarLeftPortalTarget, setToolbarLeftPortalTarget] = useState<HTMLElement | null>(null)
  const [compact, setCompact] = useState(false)

  return (
    <TitlebarContext.Provider value={{ breadcrumb, setBreadcrumb, toolbarPortalTarget, setToolbarPortalTarget, toolbarLeftPortalTarget, setToolbarLeftPortalTarget, compact, setCompact }}>
      {children}
    </TitlebarContext.Provider>
  )
}

export function useTitlebar() {
  const ctx = useContext(TitlebarContext)
  if (!ctx) throw new Error('useTitlebar must be used within TitlebarProvider')
  return ctx
}

/** Sets breadcrumb on mount, clears on unmount. Segments are compared by JSON to avoid unnecessary updates. */
export function useTitlebarBreadcrumb(segments: BreadcrumbSegment[]) {
  const { setBreadcrumb } = useTitlebar()
  const key = JSON.stringify(segments)

  useEffect(() => {
    setBreadcrumb(segments)
    return () => setBreadcrumb([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setBreadcrumb])
}

/** Renders children into the titlebar's right toolbar slot via a portal. */
export function TitlebarToolbarPortal({ children }: { children: ReactNode }) {
  const { toolbarPortalTarget } = useTitlebar()
  if (!toolbarPortalTarget) return null
  return createPortal(children, toolbarPortalTarget)
}

/** Renders children into the titlebar's left toolbar slot via a portal. */
export function TitlebarToolbarLeftPortal({ children }: { children: ReactNode }) {
  const { toolbarLeftPortalTarget } = useTitlebar()
  if (!toolbarLeftPortalTarget) return null
  return createPortal(children, toolbarLeftPortalTarget)
}

/** Ref callback for the Titlebar to register its right toolbar container element. */
export function useToolbarPortalRef() {
  const { setToolbarPortalTarget } = useTitlebar()
  const ref = useCallback((el: HTMLElement | null) => {
    setToolbarPortalTarget(el)
  }, [setToolbarPortalTarget])
  return ref
}

/** Ref callback for the Titlebar to register its left toolbar container element. */
export function useToolbarLeftPortalRef() {
  const { setToolbarLeftPortalTarget } = useTitlebar()
  const ref = useCallback((el: HTMLElement | null) => {
    setToolbarLeftPortalTarget(el)
  }, [setToolbarLeftPortalTarget])
  return ref
}

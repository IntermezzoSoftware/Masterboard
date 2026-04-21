import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

const PanelHeaderActionsContext = createContext<HTMLElement | null>(null)

export const PanelHeaderActionsProvider = PanelHeaderActionsContext.Provider

/** Renders children into the nearest panel header's actions slot. */
export function PanelHeaderActionsPortal({ children }: { children: ReactNode }) {
  const target = useContext(PanelHeaderActionsContext)
  if (!target) return null
  return createPortal(children, target)
}

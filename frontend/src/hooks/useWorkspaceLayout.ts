import { useCallback, useState } from 'react'
import { makeIsValidLayout } from '@/workspace/layoutOps'
import type { LayoutNode } from '@/workspace/types'

/** Migrate layouts saved with the old { panelId } format to { panels, activeIdx }. */
function migrateLayout(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const n = raw as Record<string, unknown>
  if (n.type === 'leaf') {
    if (typeof n.panelId === 'string' && !Array.isArray(n.panels)) {
      const { panelId, ...rest } = n
      return { ...rest, panels: [panelId], activeIdx: 0 }
    }
    return n
  }
  if (n.type === 'split') {
    return { ...n, first: migrateLayout(n.first), second: migrateLayout(n.second) }
  }
  return raw
}

export function useWorkspaceLayout(
  storageKey: string,
  validPanelIds: readonly string[],
  defaultLayout: LayoutNode,
): [LayoutNode, (layout: LayoutNode) => void] {
  const isValidLayout = makeIsValidLayout(validPanelIds)

  const [layout, setLayoutState] = useState<LayoutNode>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        const migrated = migrateLayout(parsed)
        if (isValidLayout(migrated)) return migrated as LayoutNode
      }
    } catch { /* fall through to default */ }
    return defaultLayout
  })

  const setLayout = useCallback((next: LayoutNode) => {
    setLayoutState(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
  }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return [layout, setLayout]
}

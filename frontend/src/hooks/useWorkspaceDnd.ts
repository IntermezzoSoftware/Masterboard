import { useState } from 'react'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { PANEL_DEFS } from '@/workspace/panelRegistry'
import { moveTab, moveLeaf, reorderTab, findLeafById } from '@/workspace/layoutOps'
import type { DropPosition } from '@/workspace/layoutOps'
import type { LayoutNode, PanelId } from '@/workspace/types'
import { activePanel } from '@/workspace/types'

interface WorkspaceDndResult {
  activePanelLabel: string | null
  handleDragStart: (e: DragStartEvent) => void
  handleDragEnd: (e: DragEndEvent) => void
}

export function useWorkspaceDnd(
  layout: LayoutNode,
  setLayout: (layout: LayoutNode) => void,
): WorkspaceDndResult {
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const handleDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id))

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null)
    if (!e.over || e.active.id === e.over.id) return

    const overId = String(e.over.id)
    const activeId = String(e.active.id)

    // Tab-slot drop zone (tab bar reorder or merge-into-tab-group)
    if (overId.startsWith('tab-slot:')) {
      const parts = overId.slice('tab-slot:'.length).split(':')
      if (parts.length < 3) return
      const targetLeafId  = parts[0]
      const targetPanelId = parts[1] as PanelId
      const side          = parts[2] as 'before' | 'after'
      if (activeId.startsWith('tab:')) {
        const tabParts = activeId.slice('tab:'.length).split(':')
        if (tabParts.length < 2) return
        const sourceLeafId  = tabParts[0]
        const sourcePanelId = tabParts[1] as PanelId
        if (sourceLeafId === targetLeafId) {
          // Reorder within same tab bar
          setLayout(reorderTab(layout, sourceLeafId, sourcePanelId, targetPanelId, side))
        } else {
          // Tab from another leaf dropped onto this tab bar → merge into group
          setLayout(moveTab(layout, sourceLeafId, sourcePanelId, targetLeafId, 'center'))
        }
      } else {
        // Group/leaf drag dropped onto a tab bar → merge into that leaf's group
        if (activeId !== targetLeafId) {
          setLayout(moveLeaf(layout, activeId, targetLeafId, 'center'))
        }
      }
      return
    }

    // Panel drop zone: "{leafId}:{zone}"
    const colonIdx = overId.lastIndexOf(':')
    if (colonIdx === -1) return
    const targetLeafId = overId.slice(0, colonIdx)
    const zone = overId.slice(colonIdx + 1) as DropPosition

    if (activeId.startsWith('tab:')) {
      // Individual tab drag
      const rest = activeId.slice('tab:'.length)
      const sepIdx = rest.indexOf(':')
      if (sepIdx === -1) return
      const sourceLeafId  = rest.slice(0, sepIdx)
      const sourcePanelId = rest.slice(sepIdx + 1) as PanelId
      setLayout(moveTab(layout, sourceLeafId, sourcePanelId, targetLeafId, zone))
    } else {
      // Whole leaf (group) drag
      setLayout(moveLeaf(layout, activeId, targetLeafId, zone))
    }
  }

  const activePanelLabel = activeDragId
    ? (() => {
        if (activeDragId.startsWith('tab:')) {
          const panelId = activeDragId.split(':')[2] as PanelId
          return PANEL_DEFS[panelId]?.label ?? null
        }
        const leaf = findLeafById(layout, activeDragId)
        return leaf ? PANEL_DEFS[activePanel(leaf)].label : null
      })()
    : null

  return { activePanelLabel, handleDragStart, handleDragEnd }
}

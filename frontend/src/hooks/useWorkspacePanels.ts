import { getActiveIds, getTotalPanelCount, addPanel, removePanel, setActiveTab } from '@/workspace/layoutOps'
import type { LayoutNode, PanelId } from '@/workspace/types'

interface WorkspacePanelsResult {
  activeIds: Set<PanelId>
  totalPanelCount: number
  handleAdd: (id: PanelId) => void
  handleRemove: (id: PanelId) => void
  handleSetActiveTab: (leafId: string, tabIdx: number) => void
}

export function useWorkspacePanels(
  layout: LayoutNode,
  setLayout: (layout: LayoutNode) => void,
): WorkspacePanelsResult {
  const activeIds = getActiveIds(layout)
  const totalPanelCount = getTotalPanelCount(layout)
  const handleAdd = (id: PanelId) => setLayout(addPanel(layout, id))
  const handleRemove = (id: PanelId) => setLayout(removePanel(layout, id))
  const handleSetActiveTab = (leafId: string, tabIdx: number) => setLayout(setActiveTab(layout, leafId, tabIdx))

  return { activeIds, totalPanelCount, handleAdd, handleRemove, handleSetActiveTab }
}

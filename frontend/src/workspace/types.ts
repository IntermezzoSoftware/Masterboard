export type PanelId = 'board' | 'notation' | 'engine' | 'analysis'
  | 'repertoire-board' | 'repertoire-tree' | 'repertoire-database' | 'repertoire-engine'
  | 'explorer'

export interface LeafNode {
  type: 'leaf'
  id: string
  panels: PanelId[]   // always length >= 1
  activeIdx: number   // 0-based index into panels[]
}

export interface SplitNode {
  type: 'split'
  id: string
  direction: 'h' | 'v'  // h = side-by-side, v = stacked
  first: LayoutNode
  second: LayoutNode
}

export type LayoutNode = LeafNode | SplitNode

/** The PanelId currently visible in a leaf. */
export function activePanel(leaf: LeafNode): PanelId {
  return leaf.panels[leaf.activeIdx]
}

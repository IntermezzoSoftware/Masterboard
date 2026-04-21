import type { LayoutNode, LeafNode, SplitNode, PanelId } from './types'

function makeId(): string {
  return crypto.randomUUID()
}


export const DEFAULT_LAYOUT: LayoutNode = {
  type: 'split', id: '1', direction: 'h',
  first: { type: 'leaf', id: '2', panels: ['board'], activeIdx: 0 },
  second: {
    type: 'split', id: '3', direction: 'v',
    first:  { type: 'leaf', id: '4', panels: ['notation'], activeIdx: 0 },
    second: { type: 'leaf', id: '5', panels: ['engine'],   activeIdx: 0 },
  },
}

export const DEFAULT_REPERTOIRE_LAYOUT: LayoutNode = {
  type: 'split', id: '10', direction: 'h',
  first: { type: 'leaf', id: '11', panels: ['repertoire-board'], activeIdx: 0 },
  second: {
    type: 'split', id: '12', direction: 'v',
    first:  { type: 'leaf', id: '13', panels: ['repertoire-tree'],     activeIdx: 0 },
    second: { type: 'leaf', id: '14', panels: ['repertoire-database'], activeIdx: 0 },
  },
}


export function getActiveIds(tree: LayoutNode): Set<PanelId> {
  const ids = new Set<PanelId>()
  collectIds(tree, ids)
  return ids
}

function collectIds(tree: LayoutNode, ids: Set<PanelId>): void {
  if (tree.type === 'leaf') {
    for (const p of tree.panels) ids.add(p)
    return
  }
  collectIds(tree.first, ids)
  collectIds(tree.second, ids)
}

export function getLeafCount(tree: LayoutNode): number {
  if (tree.type === 'leaf') return 1
  return getLeafCount(tree.first) + getLeafCount(tree.second)
}

/** Sum of panels.length across all leaves. */
export function getTotalPanelCount(tree: LayoutNode): number {
  if (tree.type === 'leaf') return tree.panels.length
  return getTotalPanelCount(tree.first) + getTotalPanelCount(tree.second)
}

export function findLeafById(tree: LayoutNode, leafId: string): LeafNode | null {
  if (tree.type === 'leaf') return tree.id === leafId ? tree : null
  return findLeafById(tree.first, leafId) ?? findLeafById(tree.second, leafId)
}

/** Last leaf in DFS order (always recurses into `second` first). */
function findLastLeaf(tree: LayoutNode): LeafNode {
  if (tree.type === 'leaf') return tree
  return findLastLeaf(tree.second)
}


/** Replace the leaf with the given id; no-op if not found. */
function replaceLeaf(tree: LayoutNode, leafId: string, replacement: LeafNode): LayoutNode {
  if (tree.type === 'leaf') return tree.id === leafId ? replacement : tree
  const newFirst  = replaceLeaf(tree.first,  leafId, replacement)
  const newSecond = replaceLeaf(tree.second, leafId, replacement)
  if (newFirst === tree.first && newSecond === tree.second) return tree
  return { ...tree, first: newFirst, second: newSecond }
}

/** Remove the leaf with the given id; returns null if tree becomes empty. */
function removeLeafById(tree: LayoutNode, leafId: string): LayoutNode | null {
  if (tree.type === 'leaf') return tree.id === leafId ? null : tree
  const newFirst  = removeLeafById(tree.first,  leafId)
  const newSecond = removeLeafById(tree.second, leafId)
  if (newFirst  === null) return newSecond
  if (newSecond === null) return newFirst
  if (newFirst === tree.first && newSecond === tree.second) return tree
  return { ...tree, first: newFirst, second: newSecond }
}

/** Remove a leaf that contains panelId (only if panels.length === 1). */
function removeLeafByPanelId(tree: LayoutNode, panelId: PanelId): LayoutNode | null {
  if (tree.type === 'leaf') return tree.panels[0] === panelId && tree.panels.length === 1 ? null : tree
  const newFirst  = removeLeafByPanelId(tree.first,  panelId)
  const newSecond = removeLeafByPanelId(tree.second, panelId)
  if (newFirst  === null) return newSecond
  if (newSecond === null) return newFirst
  if (newFirst === tree.first && newSecond === tree.second) return tree
  return { ...tree, first: newFirst, second: newSecond }
}


/** Add a panel by splitting the last leaf. No-op if already present. */
export function addPanel(tree: LayoutNode, panelId: PanelId): LayoutNode {
  if (getActiveIds(tree).has(panelId)) return tree
  const target = findLastLeaf(tree)
  const newLeaf: LeafNode = { type: 'leaf', id: makeId(), panels: [panelId], activeIdx: 0 }
  return doSplitLeaf(tree, target.id, newLeaf)
}

function doSplitLeaf(tree: LayoutNode, targetId: string, newLeaf: LeafNode): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.id !== targetId) return tree
    const split: SplitNode = {
      type: 'split', id: makeId(), direction: 'h',
      first: tree, second: newLeaf,
    }
    return split
  }
  const newFirst  = doSplitLeaf(tree.first,  targetId, newLeaf)
  const newSecond = doSplitLeaf(tree.second, targetId, newLeaf)
  if (newFirst === tree.first && newSecond === tree.second) return tree
  return { ...tree, first: newFirst, second: newSecond }
}

/**
 * Remove a panel. Tab-aware: removes just the tab if the leaf has more than
 * one panel, or the entire leaf if it was the last tab.
 * Never reduces the workspace to 0 panels.
 */
export function removePanel(tree: LayoutNode, panelId: PanelId): LayoutNode {
  // Find the leaf containing this panel
  const leaf = findLeafContainingPanel(tree, panelId)
  if (!leaf) return tree

  if (leaf.panels.length > 1) {
    // Multi-tab leaf: remove just the tab
    const newPanels = leaf.panels.filter(p => p !== panelId)
    const newActiveIdx = Math.min(leaf.activeIdx, newPanels.length - 1)
    const newLeaf: LeafNode = { ...leaf, panels: newPanels, activeIdx: newActiveIdx }
    return replaceLeaf(tree, leaf.id, newLeaf)
  }

  // Single-tab leaf: remove the whole leaf (guard: never remove the last panel)
  if (getTotalPanelCount(tree) <= 1) return tree
  return removeLeafByPanelId(tree, panelId) ?? tree
}

function findLeafContainingPanel(tree: LayoutNode, panelId: PanelId): LeafNode | null {
  if (tree.type === 'leaf') return tree.panels.includes(panelId) ? tree : null
  return findLeafContainingPanel(tree.first, panelId) ?? findLeafContainingPanel(tree.second, panelId)
}

/**
 * Merge two leaves into a tab group. The source leaf's panels are appended to
 * the target leaf's panels, then the source leaf is removed.
 * Center-drop on the same leaf is a no-op.
 */
export function mergePanels(
  tree: LayoutNode,
  sourceLeafId: string,
  targetLeafId: string,
): LayoutNode {
  if (sourceLeafId === targetLeafId) return tree
  const sourceLeaf = findLeafById(tree, sourceLeafId)
  const targetLeaf = findLeafById(tree, targetLeafId)
  if (!sourceLeaf || !targetLeaf) return tree
  if (getLeafCount(tree) <= 1) return tree

  // Deduplicate: skip source panels already in the layout (excluding source leaf itself)
  const treeWithout = removeLeafById(tree, sourceLeafId)
  if (!treeWithout) return tree
  const existingIds = getActiveIds(treeWithout)
  const newPanels = sourceLeaf.panels.filter(p => !existingIds.has(p))
  if (newPanels.length === 0) return treeWithout

  const mergedPanels = [...targetLeaf.panels, ...newPanels]
  const newActiveIdx = targetLeaf.panels.length  // first of the newly appended tabs
  const mergedLeaf: LeafNode = { ...targetLeaf, panels: mergedPanels, activeIdx: newActiveIdx }
  return replaceLeaf(treeWithout, targetLeafId, mergedLeaf)
}

/** Make panelId the active (visible) tab in whichever leaf it belongs to. No-op if not found or already active. */
export function activatePanelById(tree: LayoutNode, panelId: PanelId): LayoutNode {
  const leaf = findLeafContainingPanel(tree, panelId)
  if (!leaf) return tree
  const idx = leaf.panels.indexOf(panelId)
  if (idx === -1 || idx === leaf.activeIdx) return tree
  return setActiveTab(tree, leaf.id, idx)
}

/** Set the active tab of a leaf. */
export function setActiveTab(tree: LayoutNode, leafId: string, tabIdx: number): LayoutNode {
  const leaf = findLeafById(tree, leafId)
  if (!leaf || tabIdx < 0 || tabIdx >= leaf.panels.length) return tree
  return replaceLeaf(tree, leafId, { ...leaf, activeIdx: tabIdx })
}

/**
 * Reorder a tab within its leaf: move panelId to be before or after targetPanelId.
 * No-op if panelId === targetPanelId or leaf not found.
 */
export function reorderTab(
  tree: LayoutNode,
  leafId: string,
  panelId: PanelId,
  targetPanelId: PanelId,
  side: 'before' | 'after',
): LayoutNode {
  if (panelId === targetPanelId) return tree
  const leaf = findLeafById(tree, leafId)
  if (!leaf) return tree

  const srcIdx = leaf.panels.indexOf(panelId)
  const tgtIdx = leaf.panels.indexOf(targetPanelId)
  if (srcIdx === -1 || tgtIdx === -1) return tree

  const panels = leaf.panels.filter(p => p !== panelId)
  const insertAt = side === 'before'
    ? panels.indexOf(targetPanelId)
    : panels.indexOf(targetPanelId) + 1
  panels.splice(insertAt, 0, panelId)

  // Adjust activeIdx to follow the active panel
  const activePanel = leaf.panels[leaf.activeIdx]
  const newActiveIdx = panels.indexOf(activePanel)

  return replaceLeaf(tree, leafId, { ...leaf, panels, activeIdx: newActiveIdx })
}

export type DropPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'

/**
 * Move a single tab (sourcePanelId) from sourceLeafId to the given position
 * on targetLeafId.
 * - center: merge into target leaf's tab group
 * - edge: remove from source leaf (or whole leaf if last tab), split target
 */
export function moveTab(
  tree: LayoutNode,
  sourceLeafId: string,
  sourcePanelId: PanelId,
  targetLeafId: string,
  position: DropPosition,
): LayoutNode {
  // Same-leaf center = no-op; same-leaf single-tab edge = no-op (nothing to split out)
  if (sourceLeafId === targetLeafId && position === 'center') return tree

  if (position === 'center') {
    const sourceLeaf = findLeafById(tree, sourceLeafId)
    if (!sourceLeaf) return tree

    if (sourceLeaf.panels.length === 1) {
      return mergePanels(tree, sourceLeafId, targetLeafId)
    }

    // Remove the tab from source, then append it to target
    const newSourcePanels = sourceLeaf.panels.filter(p => p !== sourcePanelId)
    const newSourceActiveIdx = Math.min(sourceLeaf.activeIdx, newSourcePanels.length - 1)
    const treeWithTabRemoved = replaceLeaf(
      tree, sourceLeafId,
      { ...sourceLeaf, panels: newSourcePanels, activeIdx: newSourceActiveIdx },
    )

    const targetLeaf = findLeafById(treeWithTabRemoved, targetLeafId)
    if (!targetLeaf) return treeWithTabRemoved

    if (targetLeaf.panels.includes(sourcePanelId)) return treeWithTabRemoved

    const mergedPanels = [...targetLeaf.panels, sourcePanelId]
    const newActiveIdx = mergedPanels.length - 1
    return replaceLeaf(treeWithTabRemoved, targetLeafId, { ...targetLeaf, panels: mergedPanels, activeIdx: newActiveIdx })
  }

  // Edge drop: remove the tab from source, split target
  const sourceLeaf = findLeafById(tree, sourceLeafId)
  if (!sourceLeaf) return tree

  // Same-leaf edge drop only valid when there are multiple tabs to split from
  if (sourceLeafId === targetLeafId && sourceLeaf.panels.length <= 1) return tree

  let treeWithout: LayoutNode
  if (sourceLeaf.panels.length === 1) {
    if (getLeafCount(tree) <= 1) return tree
    treeWithout = removeLeafById(tree, sourceLeafId) ?? tree
  } else {
    const newPanels = sourceLeaf.panels.filter(p => p !== sourcePanelId)
    const newActiveIdx = Math.min(sourceLeaf.activeIdx, newPanels.length - 1)
    treeWithout = replaceLeaf(tree, sourceLeafId, { ...sourceLeaf, panels: newPanels, activeIdx: newActiveIdx })
  }

  const newLeaf: LeafNode = { type: 'leaf', id: makeId(), panels: [sourcePanelId], activeIdx: 0 }
  const direction: 'h' | 'v' = (position === 'left' || position === 'right') ? 'h' : 'v'
  const sourceFirst = position === 'left' || position === 'top'
  return doSplitLeafById(treeWithout, targetLeafId, newLeaf, direction, sourceFirst)
}

/**
 * Move an entire leaf node (all its tabs) to a new position.
 * - center: merge all source panels into target's tab group
 * - edge: move the entire leaf to be adjacent to target
 */
export function moveLeaf(
  tree: LayoutNode,
  sourceLeafId: string,
  targetLeafId: string,
  position: DropPosition,
): LayoutNode {
  if (sourceLeafId === targetLeafId) return tree

  if (position === 'center') {
    return mergePanels(tree, sourceLeafId, targetLeafId)
  }

  const sourceLeaf = findLeafById(tree, sourceLeafId)
  if (!sourceLeaf) return tree
  if (getLeafCount(tree) <= 1) return tree

  const treeWithout = removeLeafById(tree, sourceLeafId)
  if (!treeWithout) return tree

  const direction: 'h' | 'v' = (position === 'left' || position === 'right') ? 'h' : 'v'
  const sourceFirst = position === 'left' || position === 'top'
  return doSplitLeafById(treeWithout, targetLeafId, sourceLeaf, direction, sourceFirst)
}

function doSplitLeafById(
  tree: LayoutNode,
  targetId: string,
  newLeaf: LeafNode,
  direction: 'h' | 'v',
  newLeafFirst: boolean,
): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.id !== targetId) return tree
    const split: SplitNode = {
      type: 'split', id: makeId(), direction,
      first:  newLeafFirst ? newLeaf : tree,
      second: newLeafFirst ? tree : newLeaf,
    }
    return split
  }
  const newFirst  = doSplitLeafById(tree.first,  targetId, newLeaf, direction, newLeafFirst)
  const newSecond = doSplitLeafById(tree.second, targetId, newLeaf, direction, newLeafFirst)
  if (newFirst === tree.first && newSecond === tree.second) return tree
  return { ...tree, first: newFirst, second: newSecond }
}

/**
 * Returns a layout validator that checks whether a LayoutNode tree contains
 * only panel IDs from the provided set. Pass different sets for different
 * page layouts (board vs. repertoire).
 */
export function makeIsValidLayout(validIds: readonly string[]): (node: unknown) => boolean {
  function isValid(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false
    const n = node as Record<string, unknown>
    if (n.type === 'leaf') {
      return (
        typeof n.id === 'string' &&
        Array.isArray(n.panels) &&
        (n.panels as unknown[]).length >= 1 &&
        (n.panels as unknown[]).every(p => typeof p === 'string' && validIds.includes(p as string)) &&
        typeof n.activeIdx === 'number' &&
        Number.isInteger(n.activeIdx) &&
        n.activeIdx >= 0 &&
        n.activeIdx < (n.panels as unknown[]).length
      )
    }
    if (n.type === 'split') {
      return (
        typeof n.id === 'string' &&
        (n.direction === 'h' || n.direction === 'v') &&
        isValid(n.first) &&
        isValid(n.second)
      )
    }
    return false
  }
  return isValid
}

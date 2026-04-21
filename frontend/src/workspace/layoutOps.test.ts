import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LAYOUT,
  getActiveIds,
  getTotalPanelCount,
  getLeafCount,
  findLeafById,
  addPanel,
  removePanel,
  mergePanels,
  setActiveTab,
  reorderTab,
  moveTab,
  moveLeaf,
  makeIsValidLayout,
} from './layoutOps'
import type { LayoutNode, LeafNode } from './types'


function leaf(id: string, panels: string[], activeIdx = 0): LeafNode {
  return { type: 'leaf', id, panels: panels as LeafNode['panels'], activeIdx }
}

function hSplit(id: string, first: LayoutNode, second: LayoutNode): LayoutNode {
  return { type: 'split', id, direction: 'h', first, second }
}


describe('getActiveIds', () => {
  it('collects panels from all tabs including inactive ones', () => {
    const tree = leaf('a', ['board', 'notation'], 0)
    expect(getActiveIds(tree)).toEqual(new Set(['board', 'notation']))
  })

  it('collects from nested splits', () => {
    const tree = hSplit('s', leaf('a', ['board']), leaf('b', ['notation', 'engine'], 1))
    expect(getActiveIds(tree)).toEqual(new Set(['board', 'notation', 'engine']))
  })
})


describe('getTotalPanelCount', () => {
  it('counts single-tab leaves', () => {
    expect(getTotalPanelCount(DEFAULT_LAYOUT)).toBe(3) // board + notation + engine
  })

  it('counts multi-tab leaves', () => {
    const tree = hSplit('s', leaf('a', ['board', 'explorer']), leaf('b', ['notation']))
    expect(getTotalPanelCount(tree)).toBe(3)
  })
})


describe('addPanel', () => {
  it('adds a new panel as a new leaf', () => {
    const tree = leaf('a', ['board'])
    const result = addPanel(tree, 'notation')
    expect(getLeafCount(result)).toBe(2)
    expect(getActiveIds(result).has('notation')).toBe(true)
  })

  it('is a no-op when panel is already present in a tab', () => {
    const tree = leaf('a', ['board', 'notation'])
    expect(addPanel(tree, 'notation')).toBe(tree)
  })
})


describe('removePanel', () => {
  it('removes a tab from a multi-tab leaf, keeping the leaf', () => {
    const tree = leaf('a', ['board', 'notation', 'engine'], 1)
    const result = removePanel(tree, 'notation')
    expect(result.type).toBe('leaf')
    const l = result as LeafNode
    expect(l.panels).toEqual(['board', 'engine'])
    expect(l.activeIdx).toBe(1) // was idx 1, notation removed, engine slides to 1
  })

  it('clamps activeIdx when removing the last tab in a multi-tab leaf', () => {
    const tree = leaf('a', ['board', 'notation'], 1)
    const result = removePanel(tree, 'notation')
    const l = result as LeafNode
    expect(l.panels).toEqual(['board'])
    expect(l.activeIdx).toBe(0)
  })

  it('removes the whole leaf when it is a single-tab leaf', () => {
    const tree = hSplit('s', leaf('a', ['board']), leaf('b', ['notation']))
    const result = removePanel(tree, 'notation')
    expect(getLeafCount(result)).toBe(1)
    expect(getActiveIds(result)).toEqual(new Set(['board']))
  })

  it('refuses to remove the only panel in the workspace', () => {
    const tree = leaf('a', ['board'])
    expect(removePanel(tree, 'board')).toBe(tree)
  })
})


describe('mergePanels', () => {
  it('merges source panels into target and removes source leaf', () => {
    const tree = hSplit('s', leaf('a', ['board']), leaf('b', ['notation']))
    const result = mergePanels(tree, 'a', 'b')
    expect(getLeafCount(result)).toBe(1)
    const l = result as LeafNode
    expect(l.panels).toEqual(['notation', 'board'])
    expect(l.activeIdx).toBe(1) // first newly-appended panel
  })

  it('is a no-op for self-drop', () => {
    const tree = leaf('a', ['board'])
    expect(mergePanels(tree, 'a', 'a')).toBe(tree)
  })

  it('deduplicates panels already present in target', () => {
    const tree = hSplit('s', leaf('a', ['board', 'notation']), leaf('b', ['notation']))
    const result = mergePanels(tree, 'a', 'b')
    // 'board' should be added; 'notation' already in target, skip
    const l = result as LeafNode
    expect(l.panels).toContain('board')
    expect(l.panels.filter(p => p === 'notation').length).toBe(1)
  })

  it('is a no-op on a single-leaf tree', () => {
    const tree = leaf('a', ['board'])
    const result = mergePanels(tree, 'a', 'a')
    expect(result).toBe(tree)
  })
})


describe('setActiveTab', () => {
  it('updates activeIdx', () => {
    const tree = leaf('a', ['board', 'notation'], 0)
    const result = setActiveTab(tree, 'a', 1)
    expect((result as LeafNode).activeIdx).toBe(1)
  })

  it('is a no-op for out-of-range index', () => {
    const tree = leaf('a', ['board', 'notation'], 0)
    expect(setActiveTab(tree, 'a', 5)).toBe(tree)
  })
})


describe('reorderTab', () => {
  it('moves a panel before the target', () => {
    const tree = leaf('a', ['board', 'notation', 'engine'], 0)
    const result = reorderTab(tree, 'a', 'engine', 'board', 'before')
    expect((result as LeafNode).panels).toEqual(['engine', 'board', 'notation'])
  })

  it('moves a panel after the target', () => {
    const tree = leaf('a', ['board', 'notation', 'engine'], 0)
    const result = reorderTab(tree, 'a', 'board', 'engine', 'after')
    expect((result as LeafNode).panels).toEqual(['notation', 'engine', 'board'])
  })

  it('follows the active panel after reorder', () => {
    const tree = leaf('a', ['board', 'notation', 'engine'], 2) // engine active
    const result = reorderTab(tree, 'a', 'engine', 'board', 'before')
    const l = result as LeafNode
    expect(l.panels[l.activeIdx]).toBe('engine')
  })

  it('is a no-op when source === target', () => {
    const tree = leaf('a', ['board', 'notation'])
    expect(reorderTab(tree, 'a', 'board', 'board', 'before')).toBe(tree)
  })
})


describe('moveTab', () => {
  it('center drop merges the tab into the target leaf', () => {
    const tree = hSplit('s', leaf('a', ['board', 'explorer'], 0), leaf('b', ['notation']))
    const result = moveTab(tree, 'a', 'explorer', 'b', 'center')
    expect(getLeafCount(result)).toBe(2)
    const srcLeaf = findLeafById(result, 'a')!
    const tgtLeaf = findLeafById(result, 'b')!
    expect(srcLeaf.panels).toEqual(['board'])
    expect(tgtLeaf.panels).toContain('notation')
    expect(tgtLeaf.panels).toContain('explorer')
  })

  it('center drop removes source leaf when it was last tab', () => {
    const tree = hSplit('s', leaf('a', ['board']), leaf('b', ['notation']))
    const result = moveTab(tree, 'a', 'board', 'b', 'center')
    expect(getLeafCount(result)).toBe(1)
    const l = result as LeafNode
    expect(l.panels).toContain('board')
    expect(l.panels).toContain('notation')
  })

  it('right drop splits the tab out to the right', () => {
    const tree = hSplit('s', leaf('a', ['board', 'notation'], 0), leaf('b', ['engine']))
    const result = moveTab(tree, 'a', 'notation', 'b', 'right')
    expect(getLeafCount(result)).toBe(3)
    expect(getActiveIds(result)).toEqual(new Set(['board', 'notation', 'engine']))
  })

  it('is a no-op for same-leaf center drop', () => {
    const tree = hSplit('s', leaf('a', ['board', 'notation']), leaf('b', ['engine']))
    expect(moveTab(tree, 'a', 'notation', 'a', 'center')).toBe(tree)
  })
})


describe('moveLeaf', () => {
  it('center drop merges all tabs of source leaf into target', () => {
    const tree = hSplit('s', leaf('a', ['board', 'explorer']), leaf('b', ['notation']))
    const result = moveLeaf(tree, 'a', 'b', 'center')
    expect(getLeafCount(result)).toBe(1)
    const l = result as LeafNode
    expect(l.panels).toContain('notation')
    expect(l.panels).toContain('board')
    expect(l.panels).toContain('explorer')
  })

  it('left drop places leaf to the left of target', () => {
    const tree = hSplit('s', leaf('a', ['board']), leaf('b', ['notation']))
    const result = moveLeaf(tree, 'a', 'b', 'left')
    // Result should still have 2 leaves (a moved to left of b, tree restructured)
    expect(getLeafCount(result)).toBe(2)
    expect(getActiveIds(result)).toEqual(new Set(['board', 'notation']))
  })

  it('is a no-op for same-leaf', () => {
    const tree = hSplit('s', leaf('a', ['board']), leaf('b', ['notation']))
    expect(moveLeaf(tree, 'a', 'a', 'center')).toBe(tree)
  })

  it('is a no-op for single-leaf tree', () => {
    const tree = leaf('a', ['board'])
    expect(moveLeaf(tree, 'a', 'a', 'right')).toBe(tree)
  })
})


describe('makeIsValidLayout', () => {
  const valid = makeIsValidLayout(['board', 'notation', 'engine'])

  it('accepts a valid multi-tab leaf', () => {
    expect(valid(leaf('a', ['board', 'notation'], 1))).toBe(true)
  })

  it('rejects a leaf with out-of-range activeIdx', () => {
    expect(valid({ type: 'leaf', id: 'a', panels: ['board'], activeIdx: 5 })).toBe(false)
  })

  it('rejects a leaf with unknown panelId', () => {
    expect(valid({ type: 'leaf', id: 'a', panels: ['board', 'unknown'], activeIdx: 0 })).toBe(false)
  })

  it('rejects old-format leaf with panelId instead of panels', () => {
    expect(valid({ type: 'leaf', id: 'a', panelId: 'board' })).toBe(false)
  })

  it('accepts the default layout', () => {
    expect(valid(DEFAULT_LAYOUT)).toBe(true)
  })
})


describe('migration helper', () => {
  // We re-implement the migration here to test its output through the validator
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

  const valid = makeIsValidLayout(['board', 'notation', 'engine'])

  it('migrates old panelId format to panels array', () => {
    const old = { type: 'leaf', id: 'a', panelId: 'board' }
    const migrated = migrateLayout(old)
    expect(valid(migrated)).toBe(true)
    expect((migrated as Record<string, unknown>).panels).toEqual(['board'])
  })

  it('migrates a nested split tree', () => {
    const old = {
      type: 'split', id: '1', direction: 'h',
      first:  { type: 'leaf', id: '2', panelId: 'board' },
      second: { type: 'leaf', id: '3', panelId: 'notation' },
    }
    expect(valid(migrateLayout(old))).toBe(true)
  })
})

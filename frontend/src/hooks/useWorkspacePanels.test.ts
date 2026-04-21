import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useWorkspacePanels } from './useWorkspacePanels'
import { addPanel, removePanel, setActiveTab } from '@/workspace/layoutOps'
import type { LayoutNode, LeafNode } from '@/workspace/types'

function stripIds(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const n = node as Record<string, unknown>
  const { id: _id, ...rest } = n
  if (rest.type === 'split') {
    return { ...rest, first: stripIds(rest.first), second: stripIds(rest.second) }
  }
  return rest
}

function leaf(id: string, panels: string[], activeIdx = 0): LeafNode {
  return { type: 'leaf', id, panels: panels as LeafNode['panels'], activeIdx }
}

function hSplit(id: string, first: LayoutNode, second: LayoutNode): LayoutNode {
  return { type: 'split', id, direction: 'h', first, second }
}

const LAYOUT = hSplit('s', leaf('L1', ['board']), leaf('L2', ['notation', 'engine'], 0))

describe('useWorkspacePanels', () => {
  it('activeIds reflects panels in layout', () => {
    const { result } = renderHook(() => useWorkspacePanels(LAYOUT, vi.fn()))
    expect(result.current.activeIds).toEqual(new Set(['board', 'notation', 'engine']))
  })

  it('totalPanelCount is correct for multi-leaf layout', () => {
    const { result } = renderHook(() => useWorkspacePanels(LAYOUT, vi.fn()))
    expect(result.current.totalPanelCount).toBe(3)
  })

  it('handleAdd calls setLayout with result of addPanel', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspacePanels(LAYOUT, setLayout))
    act(() => result.current.handleAdd('explorer'))
    expect(setLayout).toHaveBeenCalledOnce()
    expect(stripIds(setLayout.mock.calls[0][0])).toEqual(stripIds(addPanel(LAYOUT, 'explorer')))
  })

  it('handleRemove calls setLayout with result of removePanel', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspacePanels(LAYOUT, setLayout))
    act(() => result.current.handleRemove('board'))
    expect(setLayout).toHaveBeenCalledWith(removePanel(LAYOUT, 'board'))
  })

  it('handleSetActiveTab calls setLayout with result of setActiveTab', () => {
    const setLayout = vi.fn()
    const layout = leaf('L1', ['notation', 'engine'], 0)
    const { result } = renderHook(() => useWorkspacePanels(layout, setLayout))
    act(() => result.current.handleSetActiveTab('L1', 1))
    expect(setLayout).toHaveBeenCalledWith(setActiveTab(layout, 'L1', 1))
  })
})

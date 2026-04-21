import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useWorkspaceDnd } from './useWorkspaceDnd'
import { moveTab, moveLeaf, reorderTab } from '@/workspace/layoutOps'
import type { LayoutNode, LeafNode } from '@/workspace/types'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'

/** Strip auto-generated IDs from layout nodes so structural comparisons ignore UUID noise. */
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

function dragStart(activeId: string): DragStartEvent {
  return { active: { id: activeId, data: { current: undefined }, rect: { current: { initial: null, translated: null } } } } as unknown as DragStartEvent
}

function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId, data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    over: overId ? { id: overId, data: { current: undefined }, rect: { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 } } : null,
    collisions: [],
    delta: { x: 0, y: 0 },
    activatorEvent: new MouseEvent('mousedown'),
  } as unknown as DragEndEvent
}


const LAYOUT = hSplit('s', leaf('L1', ['board']), leaf('L2', ['notation', 'engine'], 0))

describe('useWorkspaceDnd', () => {
  it('activePanelLabel is null when no drag is active', () => {
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, vi.fn()))
    expect(result.current.activePanelLabel).toBeNull()
  })

  it('handleDragStart with tab:leafId:panelId sets activePanelLabel to panel label', () => {
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, vi.fn()))
    act(() => result.current.handleDragStart(dragStart('tab:L1:board')))
    expect(result.current.activePanelLabel).toBe('Board')
  })

  it('handleDragStart with a leaf ID sets activePanelLabel via findLeafById', () => {
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, vi.fn()))
    act(() => result.current.handleDragStart(dragStart('L2')))
    expect(result.current.activePanelLabel).toBe('Notation')
  })

  it('handleDragEnd with no over is a no-op', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('tab:L1:board', null)))
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('handleDragEnd same active and over IDs is a no-op', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('tab:L1:board', 'tab:L1:board')))
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('handleDragEnd on tab-slot zone for same-leaf tab calls reorderTab', () => {
    const setLayout = vi.fn()
    const layout = leaf('L1', ['board', 'notation'], 0)
    const { result } = renderHook(() => useWorkspaceDnd(layout, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('tab:L1:board', 'tab-slot:L1:notation:after')))
    expect(setLayout).toHaveBeenCalledWith(reorderTab(layout, 'L1', 'board', 'notation', 'after'))
  })

  it('handleDragEnd on tab-slot zone for cross-leaf tab calls moveTab center', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('tab:L1:board', 'tab-slot:L2:notation:before')))
    expect(setLayout).toHaveBeenCalledWith(moveTab(LAYOUT, 'L1', 'board', 'L2', 'center'))
  })

  it('handleDragEnd on tab-slot zone for group drag calls moveLeaf center', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('L1', 'tab-slot:L2:notation:after')))
    expect(setLayout).toHaveBeenCalledWith(moveLeaf(LAYOUT, 'L1', 'L2', 'center'))
  })

  it('handleDragEnd on panel zone for tab drag calls moveTab with parsed zone', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('tab:L1:board', 'L2:right')))
    expect(setLayout).toHaveBeenCalledOnce()
    const expected = moveTab(LAYOUT, 'L1', 'board', 'L2', 'right')
    expect(stripIds(setLayout.mock.calls[0][0])).toEqual(stripIds(expected))
  })

  it('handleDragEnd on panel zone for group drag calls moveLeaf with parsed zone', () => {
    const setLayout = vi.fn()
    const { result } = renderHook(() => useWorkspaceDnd(LAYOUT, setLayout))
    act(() => result.current.handleDragEnd(dragEnd('L1', 'L2:bottom')))
    expect(setLayout).toHaveBeenCalledOnce()
    const expected = moveLeaf(LAYOUT, 'L1', 'L2', 'bottom')
    expect(stripIds(setLayout.mock.calls[0][0])).toEqual(stripIds(expected))
  })
})

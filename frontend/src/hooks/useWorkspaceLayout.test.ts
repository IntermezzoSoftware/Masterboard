import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useWorkspaceLayout } from './useWorkspaceLayout'
import { DEFAULT_LAYOUT, DEFAULT_REPERTOIRE_LAYOUT } from '@/workspace/layoutOps'
import { ALL_PANEL_IDS, ALL_REPERTOIRE_PANEL_IDS } from '@/workspace/panelRegistry'
import type { LayoutNode } from '@/workspace/types'

const BOARD_KEY = 'test.boardLayout'
const BOARD_IDS = ALL_PANEL_IDS

const REP_KEY = 'test.repertoireLayout'
const REP_IDS = ALL_REPERTOIRE_PANEL_IDS

const SIMPLE_BOARD_LAYOUT: LayoutNode = {
  type: 'leaf',
  id: 'x1',
  panels: ['board'],
  activeIdx: 0,
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('useWorkspaceLayout', () => {
  it('returns defaultLayout when localStorage is empty', () => {
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    expect(result.current[0]).toBe(DEFAULT_LAYOUT)
  })

  it('returns a valid stored layout from localStorage', () => {
    localStorage.setItem(BOARD_KEY, JSON.stringify(SIMPLE_BOARD_LAYOUT))
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    expect(result.current[0]).toEqual(SIMPLE_BOARD_LAYOUT)
  })

  it('migrates old { panelId } leaf format to { panels, activeIdx }', () => {
    const oldFormat = { type: 'leaf', id: 'x1', panelId: 'board' }
    localStorage.setItem(BOARD_KEY, JSON.stringify(oldFormat))
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    expect(result.current[0]).toEqual({ type: 'leaf', id: 'x1', panels: ['board'], activeIdx: 0 })
  })

  it('falls back to defaultLayout when localStorage has invalid JSON', () => {
    localStorage.setItem(BOARD_KEY, 'not-json{{{')
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    expect(result.current[0]).toBe(DEFAULT_LAYOUT)
  })

  it('falls back to defaultLayout when stored layout has invalid panel IDs', () => {
    const badLayout: LayoutNode = { type: 'leaf', id: 'x1', panels: ['unknown-panel' as never], activeIdx: 0 }
    localStorage.setItem(BOARD_KEY, JSON.stringify(badLayout))
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    expect(result.current[0]).toBe(DEFAULT_LAYOUT)
  })

  it('setter updates returned layout state', () => {
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    act(() => { result.current[1](SIMPLE_BOARD_LAYOUT) })
    expect(result.current[0]).toEqual(SIMPLE_BOARD_LAYOUT)
  })

  it('setter writes to localStorage under the correct key', () => {
    const { result } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    act(() => { result.current[1](SIMPLE_BOARD_LAYOUT) })
    const stored = JSON.parse(localStorage.getItem(BOARD_KEY)!)
    expect(stored).toEqual(SIMPLE_BOARD_LAYOUT)
  })

  it('two instances with different keys do not interfere', () => {
    const repLayout: LayoutNode = { type: 'leaf', id: 'r1', panels: ['repertoire-board'], activeIdx: 0 }

    const { result: boardResult } = renderHook(() =>
      useWorkspaceLayout(BOARD_KEY, BOARD_IDS, DEFAULT_LAYOUT)
    )
    const { result: repResult } = renderHook(() =>
      useWorkspaceLayout(REP_KEY, REP_IDS, DEFAULT_REPERTOIRE_LAYOUT)
    )

    act(() => { boardResult.current[1](SIMPLE_BOARD_LAYOUT) })
    act(() => { repResult.current[1](repLayout) })

    expect(boardResult.current[0]).toEqual(SIMPLE_BOARD_LAYOUT)
    expect(repResult.current[0]).toEqual(repLayout)
    expect(JSON.parse(localStorage.getItem(BOARD_KEY)!)).toEqual(SIMPLE_BOARD_LAYOUT)
    expect(JSON.parse(localStorage.getItem(REP_KEY)!)).toEqual(repLayout)
  })
})

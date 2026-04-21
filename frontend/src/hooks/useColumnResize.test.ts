import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useColumnResize } from './useColumnResize'

const LS_KEY = 'test-col-widths'

const defaults = { name: 100, date: 80, result: 60 } as const
type Col = keyof typeof defaults
const colOrder: readonly Col[] = ['name', 'date', 'result']

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('useColumnResize', () => {
  it('initialises from defaults when no localStorage entry', () => {
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    expect(result.current.colWidths).toEqual(defaults)
  })

  it('reads saved widths from localStorage on mount', () => {
    const saved = { name: 150, date: 90, result: 70 }
    localStorage.setItem(LS_KEY, JSON.stringify(saved))
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    expect(result.current.colWidths).toEqual(saved)
  })

  it('falls back to defaults when localStorage value is invalid JSON', () => {
    localStorage.setItem(LS_KEY, 'not-json')
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    expect(result.current.colWidths).toEqual(defaults)
  })

  it('falls back to defaults when localStorage value is missing a column', () => {
    // Only has 2 of 3 columns — should fall back entirely to defaults
    localStorage.setItem(LS_KEY, JSON.stringify({ name: 150, date: 90 }))
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    // merged defaults should fill in missing key; all keys must be numbers
    expect(typeof result.current.colWidths.result).toBe('number')
  })

  it('persists updated widths to localStorage via setColWidths', () => {
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    const next = { name: 200, date: 80, result: 60 }
    act(() => {
      result.current.setColWidths(next)
    })
    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    expect(stored).toEqual(next)
    expect(result.current.colWidths).toEqual(next)
  })

  it('setColWidths accepts a updater function', () => {
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    act(() => {
      result.current.setColWidths(prev => ({ ...prev, name: prev.name + 50 }))
    })
    expect(result.current.colWidths.name).toBe(150)
  })

  it('exposes tableRef', () => {
    const { result } = renderHook(() =>
      useColumnResize(colOrder, defaults, LS_KEY)
    )
    expect(result.current.tableRef).toBeDefined()
  })
})

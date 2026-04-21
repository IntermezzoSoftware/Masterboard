import { useRef, useState, type RefObject } from 'react'

export function useColumnResize<K extends string>(
  colOrder: readonly K[],
  defaults: Record<K, number>,
  lsKey: string,
  options?: { fixedPx?: number; minWidth?: number; activeColOrder?: readonly K[] },
): {
  colWidths: Record<K, number>
  setColWidths: (next: Record<K, number> | ((prev: Record<K, number>) => Record<K, number>)) => void
  tableRef: RefObject<HTMLTableElement | null>
  startResize: (col: K, e: React.MouseEvent) => void
} {
  const fixedPx  = options?.fixedPx  ?? 0
  const minWidth = options?.minWidth ?? 30

  const [colWidths, setColWidthsState] = useState<Record<K, number>>(() => {
    try {
      const stored = localStorage.getItem(lsKey)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') {
          const merged = { ...defaults, ...(parsed as Partial<Record<K, number>>) }
          if (colOrder.every(k => typeof merged[k] === 'number')) return merged as Record<K, number>
        }
      }
    } catch { /* fall through */ }
    return defaults
  })

  function setColWidths(next: Record<K, number> | ((prev: Record<K, number>) => Record<K, number>)) {
    setColWidthsState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try { localStorage.setItem(lsKey, JSON.stringify(resolved)) } catch { /* ignore */ }
      return resolved
    })
  }

  const tableRef = useRef<HTMLTableElement>(null)
  const dragRef  = useRef<{
    col: K; nextCol: K
    startX: number; startW: number; startWNext: number
    totalW: number; availPx: number
  } | null>(null)

  function startResize(col: K, e: React.MouseEvent) {
    e.preventDefault()
    const active = options?.activeColOrder ?? colOrder
    const idx = active.indexOf(col)
    if (idx >= active.length - 1) return
    const nextCol = active[idx + 1]
    const totalW = fixedPx + (active as K[]).reduce((a, k) => a + colWidths[k], 0)
    const availPx = tableRef.current?.getBoundingClientRect().width ?? 800
    dragRef.current = {
      col, nextCol,
      startX: e.clientX,
      startW: colWidths[col],
      startWNext: colWidths[nextCol],
      totalW, availPx,
    }
    const cursorStyle = document.createElement('style')
    cursorStyle.textContent = '* { cursor: col-resize !important; }'
    document.head.appendChild(cursorStyle)
    function onMove(me: MouseEvent) {
      if (!dragRef.current) return
      const d = dragRef.current
      const unitDelta = (me.clientX - d.startX) * d.totalW / d.availPx
      const clamped = Math.max(minWidth - d.startW, Math.min(d.startWNext - minWidth, unitDelta))
      setColWidths(prev => ({ ...prev, [d.col]: d.startW + clamped, [d.nextCol]: d.startWNext - clamped }))
    }
    function onUp() {
      dragRef.current = null
      cursorStyle.remove()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return { colWidths, setColWidths, tableRef, startResize }
}

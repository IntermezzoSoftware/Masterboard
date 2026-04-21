import { useCallback, useEffect, useRef, useState } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Key, Role, Color } from '@lichess-org/chessground/types'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'
import { chessFromFen } from '@/lib/fenUtils'
import { Dialog, DialogClose, useDialogClose } from './Dialog'
import { btnPrimary, btnGhost, btnSecondary } from '@/lib/classNames'
import { useChessGameContext } from '@/context/ChessGameContext'

const BOARD_SIZE = 320

// CgPiece renders a chessground <piece> element imperatively via a ref.
// <piece> is a chessground-internal DOM element, not a React component or
// standard HTML element — it must not appear in JSX.
function CgPiece({ role, color }: { role: string; color: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = ref.current
    if (!container) return
    const el = document.createElement('piece')
    el.className = `${role} ${color}`
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background-size:cover'
    container.appendChild(el)
    return () => { el.remove() }
  }, [role, color])
  return <div ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
}

function PositionEditorFooter({ onApply }: { onApply: () => boolean }) {
  const close = useDialogClose()
  return (
    <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
      <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
      <button onClick={() => { if (onApply()) close() }} className={btnPrimary}>Load Position</button>
    </div>
  )
}

interface PositionEditorProps {
  initialFen: string
  onClose: () => void
}

const PIECE_PICKER = [
  { role: 'king'   as Role, color: 'white' as Color },
  { role: 'queen'  as Role, color: 'white' as Color },
  { role: 'rook'   as Role, color: 'white' as Color },
  { role: 'bishop' as Role, color: 'white' as Color },
  { role: 'knight' as Role, color: 'white' as Color },
  { role: 'pawn'   as Role, color: 'white' as Color },
  { role: 'king'   as Role, color: 'black' as Color },
  { role: 'queen'  as Role, color: 'black' as Color },
  { role: 'rook'   as Role, color: 'black' as Color },
  { role: 'bishop' as Role, color: 'black' as Color },
  { role: 'knight' as Role, color: 'black' as Color },
  { role: 'pawn'   as Role, color: 'black' as Color },
] as const

function parseFenParts(fen: string) {
  const parts = fen.split(' ')
  const board = parts[0] ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
  const side: 'white' | 'black' = parts[1] === 'b' ? 'black' : 'white'
  const castleStr = parts[2] ?? 'KQkq'
  return {
    board,
    side,
    castling: {
      K: castleStr.includes('K'),
      Q: castleStr.includes('Q'),
      k: castleStr.includes('k'),
      q: castleStr.includes('q'),
    },
  }
}

export default function PositionEditor({ initialFen, onClose }: PositionEditorProps) {
  const { loadFromFEN } = useChessGameContext()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<Api | null>(null)

  const initial = parseFenParts(initialFen)
  const [boardFen, setBoardFen] = useState(initial.board)
  const [side, setSide] = useState<'white' | 'black'>(initial.side)
  const [castling, setCastling] = useState(initial.castling)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [activePiece, setActivePiece] = useState<{ role: Role; color: Color } | null>(null)
  const [error, setError] = useState('')

  // Use a callback ref instead of useEffect so Chessground is initialised when
  // the DOM node actually attaches — not during React's effect flush.  This is
  // necessary because the board lives inside a Radix Dialog portal whose first
  // render returns null (it defers via useLayoutEffect(() => setMounted(true))).
  // By the time useEffect fires, wrapRef.current is still null and Chessground
  // never initialises.  A callback ref fires at the correct moment regardless of
  // portal timing.  React 19 supports returning a cleanup function from a ref
  // callback, which is called when the element detaches.
  const boardRef = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el
    if (!el) return
    apiRef.current = Chessground(el, {
      fen: initial.board,
      orientation: 'white',
      movable: { free: true, color: 'both', dests: new Map(), showDests: false },
      draggable: { enabled: true, deleteOnDropOff: true },
      events: {
        change: () => {
          if (apiRef.current) setBoardFen(apiRef.current.getFen())
        },
      },
      premovable: { enabled: false },
      predroppable: { enabled: false },
      animation: { enabled: false },
      highlight: { lastMove: false, check: false },
      drawable: { enabled: false },
    })
    // Hide the board until the dialog entrance animation (scale 0.97→1)
    // finishes, then redraw with correct dimensions.  Without this,
    // Chessground reads getBoundingClientRect() during the scale and places
    // pieces at ~97% offsets, causing visible jitter when they snap to the
    // correct position afterwards.
    const animated = el.closest('[class*="animate-"]') as HTMLElement | null
    if (animated) {
      el.style.visibility = 'hidden'
      const onEnd = () => { el.style.visibility = ''; apiRef.current?.redrawAll() }
      animated.addEventListener('animationend', onEnd, { once: true })
      return () => { animated.removeEventListener('animationend', onEnd); apiRef.current?.destroy(); apiRef.current = null }
    }
    // Fallback: no animation ancestor — redraw immediately
    apiRef.current.redrawAll()
    return () => { apiRef.current?.destroy(); apiRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    apiRef.current?.set({ orientation })
  }, [orientation])

  function squareFromEvent(e: React.MouseEvent): Key | null {
    if (!apiRef.current || !wrapRef.current) return null
    const rect = wrapRef.current.getBoundingClientRect()
    const xFrac = (e.clientX - rect.left) / rect.width
    const yFrac = (e.clientY - rect.top) / rect.height
    const file = orientation === 'white' ? Math.floor(xFrac * 8) : 7 - Math.floor(xFrac * 8)
    const rank = orientation === 'white' ? 7 - Math.floor(yFrac * 8) : Math.floor(yFrac * 8)
    return (String.fromCharCode(97 + Math.max(0, Math.min(7, file))) + (Math.max(0, Math.min(7, rank)) + 1)) as Key
  }

  function handleBoardContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const key = squareFromEvent(e)
    if (!key || !apiRef.current) return
    apiRef.current.setPieces(new Map([[key, undefined]]))
    setBoardFen(apiRef.current.getFen())
    setError('')
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!activePiece || !apiRef.current) return
    const key = squareFromEvent(e)
    if (!key) return
    apiRef.current.newPiece(activePiece, key)
    setBoardFen(apiRef.current.getFen())
    setError('')
  }

  function handleClear() {
    const emptyFen = '8/8/8/8/8/8/8/8'
    apiRef.current?.set({ fen: emptyFen })
    setBoardFen(emptyFen)
    setActivePiece(null)
    setError('')
  }

  function handleStartingPosition() {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
    apiRef.current?.set({ fen: startFen })
    setBoardFen(startFen)
    setSide('white')
    setCastling({ K: true, Q: true, k: true, q: true })
    setActivePiece(null)
    setError('')
  }

  function handleApply(): boolean {
    const sideChar = side === 'white' ? 'w' : 'b'
    const castleStr = [
      castling.K ? 'K' : '',
      castling.Q ? 'Q' : '',
      castling.k ? 'k' : '',
      castling.q ? 'q' : '',
    ].join('') || '-'
    const fen = `${boardFen} ${sideChar} ${castleStr} - 0 1`
    try {
      chessFromFen(fen)
    } catch {
      setError('Invalid position — both kings must be present.')
      return false
    }
    loadFromFEN(fen)
    return true
  }

  const castleStr = [
    castling.K ? 'K' : '',
    castling.Q ? 'Q' : '',
    castling.k ? 'k' : '',
    castling.q ? 'q' : '',
  ].join('') || '-'
  const liveFen = `${boardFen} ${side === 'white' ? 'w' : 'b'} ${castleStr} - 0 1`

  const pickerBtnClass = (p: { role: Role; color: Color }) => [
    'w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors border',
    activePiece?.role === p.role && activePiece?.color === p.color
      ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] border-[var(--color-accent)] dark:border-[var(--color-dark-accent)]'
      : 'border-transparent hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
  ].join(' ')

  const castleBtn = (active: boolean) => [
    'px-2 py-0.5 text-xs font-medium transition-colors',
    active
      ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
      : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
  ].join(' ')

  return (
    <Dialog title="Edit position" onClose={onClose} maxWidth="sm">
      <div className="p-4 flex flex-col gap-3">

        {/* Board */}
        <div style={{ position: 'relative', width: BOARD_SIZE, height: BOARD_SIZE, alignSelf: 'center' }} onContextMenu={handleBoardContextMenu}>
          <div ref={boardRef} data-testid="position-editor-board" style={{ width: BOARD_SIZE, height: BOARD_SIZE }} />
          {activePiece && (
            <div
              data-testid="piece-overlay"
              style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'crosshair' }}
              onClick={handleOverlayClick}
            />
          )}
        </div>

        {/* Piece picker */}
        <div className="flex flex-col gap-1">
          <div className="flex gap-1 justify-center">
            {PIECE_PICKER.slice(0, 6).map(p => (
              <button
                key={`w-${p.role}`}
                onMouseDown={e => apiRef.current?.dragNewPiece({ role: p.role, color: p.color }, e.nativeEvent)}
                onClick={() => setActivePiece(activePiece?.role === p.role && activePiece?.color === p.color ? null : { role: p.role, color: p.color })}
                title={`Place white ${p.role}`}
                aria-label={`Place white ${p.role}`}
                aria-pressed={activePiece?.role === p.role && activePiece?.color === p.color}
                className={pickerBtnClass(p)}
              >
                <div className="cg-wrap" style={{ width: 32, height: 32, position: 'relative', pointerEvents: 'none', backgroundColor: '#808080', borderRadius: 2 }}>
                  <CgPiece role={p.role} color={p.color} />
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-1 justify-center">
            {PIECE_PICKER.slice(6).map(p => (
              <button
                key={`b-${p.role}`}
                onMouseDown={e => apiRef.current?.dragNewPiece({ role: p.role, color: p.color }, e.nativeEvent)}
                onClick={() => setActivePiece(activePiece?.role === p.role && activePiece?.color === p.color ? null : { role: p.role, color: p.color })}
                title={`Place black ${p.role}`}
                aria-label={`Place black ${p.role}`}
                aria-pressed={activePiece?.role === p.role && activePiece?.color === p.color}
                className={pickerBtnClass(p)}
              >
                <div className="cg-wrap" style={{ width: 32, height: 32, position: 'relative', pointerEvents: 'none', backgroundColor: '#808080', borderRadius: 2 }}>
                  <CgPiece role={p.role} color={p.color} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Side to move + flip */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] shrink-0">Side to move</span>
          <div className="flex rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <button
              onClick={() => setSide('white')}
              aria-pressed={side === 'white'}
              className={[
                'px-3 py-1 text-xs font-medium transition-colors',
                side === 'white'
                  ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
                  : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
              ].join(' ')}
            >White</button>
            <button
              onClick={() => setSide('black')}
              aria-pressed={side === 'black'}
              className={[
                'px-3 py-1 text-xs font-medium transition-colors',
                side === 'black'
                  ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
                  : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
              ].join(' ')}
            >Black</button>
          </div>
        </div>

        {/* Castling */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] shrink-0">Castling</span>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] select-none">White</span>
            <div className="flex rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              <button
                onClick={() => setCastling(c => ({ ...c, K: !c.K }))}
                aria-pressed={castling.K}
                aria-label="White kingside"
                className={castleBtn(castling.K)}
              >O-O</button>
              <button
                onClick={() => setCastling(c => ({ ...c, Q: !c.Q }))}
                aria-pressed={castling.Q}
                aria-label="White queenside"
                className={`${castleBtn(castling.Q)} border-l border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]`}
              >O-O-O</button>
            </div>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] select-none">Black</span>
            <div className="flex rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              <button
                onClick={() => setCastling(c => ({ ...c, k: !c.k }))}
                aria-pressed={castling.k}
                aria-label="Black kingside"
                className={castleBtn(castling.k)}
              >O-O</button>
              <button
                onClick={() => setCastling(c => ({ ...c, q: !c.q }))}
                aria-pressed={castling.q}
                aria-label="Black queenside"
                className={`${castleBtn(castling.q)} border-l border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]`}
              >O-O-O</button>
            </div>
          </div>
        </div>

        {/* Board shortcuts */}
        <div className="flex gap-2">
          <button onClick={handleClear} className={btnSecondary}>Clear board</button>
          <button onClick={handleStartingPosition} className={btnSecondary}>Starting position</button>
          <button onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')} className={btnSecondary} aria-label="Flip board">Flip</button>
        </div>

        {/* Live FEN preview */}
        <input
          type="text"
          readOnly
          value={liveFen}
          aria-label="Current FEN"
          className="w-full px-2 py-1.5 text-xs font-mono rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] focus:outline-none cursor-text select-all"
          onFocus={e => e.target.select()}
        />

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
      </div>

      {/* Footer — stays pinned at bottom regardless of scroll */}
      <PositionEditorFooter onApply={handleApply} />
    </Dialog>
  )
}

import { useState } from 'react'
import { Dialog, DialogClose, useDialogClose } from './Dialog'
import { btnPrimary, btnGhost } from '@/lib/classNames'
import { chessFromFen } from '@/lib/fenUtils'
import { useChessGameContext } from '@/context/ChessGameContext'

interface LoadFENDialogProps {
  onClose: () => void
}

function LoadFENForm() {
  const { loadFromFEN } = useChessGameContext()
  const close = useDialogClose()
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  function handleLoad() {
    const fen = text.trim()
    if (!fen) return
    try {
      chessFromFen(fen)
    } catch {
      setError('Invalid FEN string.')
      return
    }
    loadFromFEN(fen)
    close()
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <input
        type="text"
        value={text}
        onChange={e => { setText(e.target.value); setError('') }}
        onKeyDown={e => { if (e.key === 'Enter') handleLoad() }}
        placeholder="Paste FEN here…"
        autoFocus
        spellCheck={false}
        className={[
          'w-full px-2 py-1.5 text-xs font-mono rounded-[var(--radius-sm)]',
          'border dark:border-[var(--color-dark-surface-3)]',
          'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
          'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
          'focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] dark:focus:ring-[var(--color-dark-accent)]',
          error
            ? 'border-red-500 dark:border-red-500'
            : 'border-[var(--color-surface-3)]',
        ].join(' ')}
      />
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
        <button onClick={handleLoad} disabled={!text.trim()} className={btnPrimary}>
          Load
        </button>
      </div>
    </div>
  )
}

export default function LoadFENDialog({ onClose }: LoadFENDialogProps) {
  return (
    <Dialog title="Load position" onClose={onClose} maxWidth="sm">
      <LoadFENForm />
    </Dialog>
  )
}

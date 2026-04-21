import { useState } from 'react'
import { Dialog, DialogClose, useDialogClose } from './Dialog'
import { btnPrimary, btnGhost } from '@/lib/classNames'
import { useChessGameContext } from '@/context/ChessGameContext'

interface PastePGNDialogProps {
  onClose: () => void
}

function PastePGNForm() {
  const { loadFromPGN } = useChessGameContext()
  const close = useDialogClose()
  const [text, setText] = useState('')

  function handleLoad() {
    if (!text.trim()) return
    loadFromPGN(text.trim())
    close()
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={10}
        placeholder="Paste PGN here…"
        autoFocus
        className={[
          'w-full px-2 py-1.5 text-xs font-mono resize-none rounded-[var(--radius-sm)]',
          'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
          'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
          'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
          'focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] dark:focus:ring-[var(--color-dark-accent)]',
        ].join(' ')}
      />
      <div className="flex justify-end gap-2">
        <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
        <button onClick={handleLoad} disabled={!text.trim()} className={btnPrimary}>
          Load
        </button>
      </div>
    </div>
  )
}

export default function PastePGNDialog({ onClose }: PastePGNDialogProps) {
  return (
    <Dialog title="Load PGN" onClose={onClose} maxWidth="md">
      <PastePGNForm />
    </Dialog>
  )
}

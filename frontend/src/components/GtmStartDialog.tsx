import { useNavigate } from 'react-router'
import { Dialog, DialogClose } from '@/components/Dialog'
import { btnSecondary, btnGhost } from '@/lib/classNames'

interface Props {
  gameId: string
  onClose: () => void
}

export default function GtmStartDialog({ gameId, onClose }: Props) {
  const navigate = useNavigate()

  function start(colour: 'white' | 'black') {
    onClose()
    navigate('/guess-the-move', { state: { gameId, colour } })
  }

  return (
    <Dialog title="Guess the Move" onClose={onClose} maxWidth="xs">
      <div className="px-4 py-4">
        <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          Choose which side to play through.
        </p>
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
        <DialogClose asChild>
          <button className={btnGhost}>Cancel</button>
        </DialogClose>
        <button className={btnSecondary} onClick={() => start('white')}>Play as White</button>
        <button className={btnSecondary} onClick={() => start('black')}>Play as Black</button>
      </div>
    </Dialog>
  )
}

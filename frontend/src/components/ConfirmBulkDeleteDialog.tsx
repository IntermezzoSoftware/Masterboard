import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { btnGhost, btnDanger } from '@/lib/classNames'

interface ConfirmBulkDeleteDialogProps {
  count: number
  onConfirm: () => void
  onClose: () => void
}

function ConfirmBulkDeleteBody({ onConfirm }: { onConfirm: () => void }) {
  const close = useDialogClose()
  return (
    <div className="px-4 py-4">
      <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mb-4">
        This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <DialogClose asChild><button className={btnGhost}>
          Cancel
        </button></DialogClose>
        <button onClick={() => { onConfirm(); close() }} className={btnDanger}>
          Delete
        </button>
      </div>
    </div>
  )
}

export function ConfirmBulkDeleteDialog({ count, onConfirm, onClose }: ConfirmBulkDeleteDialogProps) {
  return (
    <Dialog onClose={onClose} title={`Delete ${count} game${count === 1 ? '' : 's'}?`} maxWidth="xs">
      <ConfirmBulkDeleteBody onConfirm={onConfirm} />
    </Dialog>
  )
}

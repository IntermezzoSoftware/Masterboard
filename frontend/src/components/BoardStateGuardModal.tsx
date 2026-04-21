import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useChessGameContext } from '@/context/ChessGameContext'
import { Dialog, useDialogClose } from '@/components/Dialog'
import SaveGameDialog from '@/components/SaveGameDialog'
import { btnDanger, btnGhost, btnPrimary } from '@/lib/classNames'
import { api, type Collection, type Folder } from '@/lib/api'

type GuardAction = 'cancel' | 'discard' | 'save'

function UnsavedFooter({ onChoose }: { onChoose: (action: GuardAction) => void }) {
  const close = useDialogClose()
  function choose(action: GuardAction) {
    onChoose(action)
    close()
  }
  return (
    <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
      <button onClick={() => choose('cancel')} className={btnGhost}>Cancel</button>
      <button onClick={() => choose('discard')} className={btnDanger}>Discard</button>
      <button onClick={() => choose('save')} className={btnPrimary}>Save</button>
    </div>
  )
}

/**
 * Renders the "Unsaved changes" confirmation dialog whenever a destructive
 * board-state action is attempted while the game is dirty. Placed in AppLayout
 * so it is available regardless of which page is currently active.
 */
export default function BoardStateGuardModal() {
  const {
    pendingDestructiveAction,
    confirmPendingDestructiveAction,
    cancelPendingDestructiveAction,
    markSaved,
    toPGN,
    gameMetadata,
  } = useChessGameContext()

  const navigate = useNavigate()
  const location = useLocation()

  const [showSave, setShowSave] = useState(false)
  const [showGuard, setShowGuard] = useState(true)
  const [folders, setFolders] = useState<Folder[]>([])
  const [collections, setCollections] = useState<Collection[]>([])

  const chosenAction = useRef<GuardAction>('cancel')
  const savedRef = useRef(false)

  useEffect(() => {
    if (!showSave) return
    Promise.all([api.listFolders(), api.listCollections()])
      .then(([f, c]) => { setFolders(f ?? []); setCollections(c ?? []) })
      .catch(() => {})
  }, [showSave])

  // Reset internal state when the guard modal is freshly triggered
  useEffect(() => {
    if (pendingDestructiveAction) {
      setShowGuard(true)
      setShowSave(false)
    }
  }, [pendingDestructiveAction])

  if (!pendingDestructiveAction) return null

  function handleGuardClose() {
    // Called after the unsaved-changes dialog exit animation completes
    setShowGuard(false)
    const action = chosenAction.current
    if (action === 'cancel') {
      cancelPendingDestructiveAction()
    } else if (action === 'discard') {
      confirmPendingDestructiveAction()
    } else {
      // 'save' — show save dialog
      if (location.pathname !== '/board') navigate('/board')
      setShowSave(true)
    }
  }

  function handleSaved(id: string) {
    markSaved(id)
    // SaveGameDialog will animate out, then onClose fires
  }

  function handleSaveClose() {
    setShowSave(false)
    if (savedRef.current) {
      savedRef.current = false
      confirmPendingDestructiveAction()
    } else {
      cancelPendingDestructiveAction()
    }
  }

  function handleSavedTracked(id: string) {
    savedRef.current = true
    handleSaved(id)
  }

  return (
    <>
      {showGuard && !showSave && (
        <Dialog title="Unsaved changes" onClose={handleGuardClose} maxWidth="xs">
          <div className="px-4 py-4 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            Your current game will be lost.
          </div>
          <UnsavedFooter onChoose={(action) => { chosenAction.current = action }} />
        </Dialog>
      )}
      {showSave && (
        <SaveGameDialog
          pgn={toPGN()}
          initialWhite={gameMetadata?.white ?? ''}
          initialBlack={gameMetadata?.black ?? ''}
          initialEvent={gameMetadata?.event ?? ''}
          initialResult={gameMetadata?.result ?? '*'}
          folders={folders}
          collections={collections}
          onSaved={handleSavedTracked}
          onClose={handleSaveClose}
        />
      )}
    </>
  )
}

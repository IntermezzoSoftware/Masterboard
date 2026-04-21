import { useState } from 'react'
import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { Select } from '@/components/Select'
import { formInput, formLabel, collectionToggle, collectionToggleActive, btnPrimary, btnGhost } from '@/lib/classNames'
import { api, type Collection, type Folder, type GameInput } from '@/lib/api'

const RESULT_OPTIONS = [
  { value: '*', label: '* (ongoing)' },
  { value: '1-0', label: '1-0 (White wins)' },
  { value: '0-1', label: '0-1 (Black wins)' },
  { value: '1/2-1/2', label: '½-½ (Draw)' },
]

interface SaveGameDialogProps {
  pgn: string
  initialWhite?: string
  initialBlack?: string
  initialEvent?: string
  initialResult?: string
  folders?: Folder[]
  collections?: Collection[]
  initialFolderId?: string | null
  onSaved: (id: string) => void
  onClose: () => void
}

function SaveGameForm({ pgn, initialWhite = '', initialBlack = '', initialEvent = '', initialResult = '*', folders = [], collections = [], initialFolderId, onSaved }: Omit<SaveGameDialogProps, 'onClose'>) {
  const close = useDialogClose()
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.')
  const [white, setWhite] = useState(initialWhite)
  const [black, setBlack] = useState(initialBlack)
  const [event, setEvent] = useState(initialEvent)
  const [date, setDate]   = useState(today)
  const [result, setResult] = useState(initialResult)
  const [folderId, setFolderId] = useState(initialFolderId ?? '')
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [duplicateId, setDuplicateId] = useState<string | null>(null)

  function toggleCollection(id: string) {
    setSelectedCollections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function buildInput(): GameInput {
    return {
      white: white || '?',
      black: black || '?',
      event: event || '?',
      date,
      result,
      site: '',
      round: '',
      eco: '',
      timeControl: '',
      source: 'manual',
      pgn,
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const input = buildInput()
      const existingId = await api.findDuplicateGame(input)
      if (existingId) {
        setDuplicateId(existingId)
        return
      }
      const id = await api.saveGame(input)
      if (folderId) {
        await api.moveGameToFolder(id, folderId)
      }
      if (selectedCollections.size > 0) {
        await Promise.all(
          [...selectedCollections].map(cid => api.addGameToCollection(id, cid))
        )
      }
      onSaved(id)
      close()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save game')
    } finally {
      setSaving(false)
    }
  }

  async function handleOverwrite() {
    if (!duplicateId) return
    setSaving(true)
    setError('')
    try {
      await api.updateGame(duplicateId, pgn)
      onSaved(duplicateId)
      close()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to overwrite game')
    } finally {
      setSaving(false)
    }
  }

  if (duplicateId) {
    return (
      <div className="animate-[dialog-body-in_150ms_ease-out]">
        {/* Conflict body */}
        <div className="px-4 py-4">
          <p className="text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            A game with the same players, date, result, and moves already exists.
            Do you want to overwrite it?
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
        {/* Conflict footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
          <DialogClose asChild><button className={btnGhost}>
            Cancel
          </button></DialogClose>
          <button
            onClick={handleOverwrite}
            disabled={saving}
            className={btnPrimary}
          >
            Overwrite
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Form */}
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={formLabel}>White</label>
            <input
              className={formInput}
              value={white}
              onChange={e => setWhite(e.target.value)}
              placeholder="White player"
            />
          </div>
          <div>
            <label className={formLabel}>Black</label>
            <input
              className={formInput}
              value={black}
              onChange={e => setBlack(e.target.value)}
              placeholder="Black player"
            />
          </div>
        </div>

        <div>
          <label className={formLabel}>Event</label>
          <input
            className={formInput}
            value={event}
            onChange={e => setEvent(e.target.value)}
            placeholder="Tournament or event name"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={formLabel}>Date</label>
            <input
              className={formInput}
              value={date}
              onChange={e => setDate(e.target.value)}
              placeholder="YYYY.MM.DD"
            />
          </div>
          <div>
            <label className={formLabel}>Result</label>
            <Select value={result} onValueChange={setResult} options={RESULT_OPTIONS} />
          </div>
        </div>

        {folders.length > 0 && (
          <div>
            <label className={formLabel}>Folder</label>
            <Select
              value={folderId}
              onValueChange={setFolderId}
              aria-label="Save to folder"
              options={[
                { value: '', label: 'No folder' },
                ...folders.map(f => ({ value: f.id, label: f.name })),
              ]}
            />
          </div>
        )}

        {collections.length > 0 && (
          <div>
            <label className={formLabel}>Collections</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {collections.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCollection(c.id)}
                  className={selectedCollections.has(c.id) ? collectionToggleActive : collectionToggle}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
        <DialogClose asChild><button className={btnGhost}>
          Cancel
        </button></DialogClose>
        <button
          onClick={handleSave}
          disabled={saving}
          className={btnPrimary}
        >
          Save
        </button>
      </div>
    </>
  )
}

export default function SaveGameDialog(props: SaveGameDialogProps) {
  return (
    <Dialog onClose={props.onClose} title="Save Game">
      <SaveGameForm {...props} />
    </Dialog>
  )
}

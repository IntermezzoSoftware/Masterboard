import { useState } from 'react'
import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { Select } from '@/components/Select'
import { formInput, formLabel, btnPrimary, btnGhost } from '@/lib/classNames'
import { api, type GameMetadataInput } from '@/lib/api'

const RESULT_OPTIONS = [
  { value: '*', label: '* (ongoing)' },
  { value: '1-0', label: '1-0 (White wins)' },
  { value: '0-1', label: '0-1 (Black wins)' },
  { value: '1/2-1/2', label: '½-½ (Draw)' },
]

interface EditMetadataDialogProps {
  gameId: string
  initial: {
    white: string; black: string
    whiteElo: number | null; blackElo: number | null
    result: string; date: string
    event: string; site: string; round: string; eco: string; opening: string
  }
  onSaved: (updated: GameMetadataInput) => void
  onClose: () => void
}

function EditMetadataForm({ gameId, initial, onSaved }: Omit<EditMetadataDialogProps, 'onClose'>) {
  const close = useDialogClose()
  const [white, setWhite]           = useState(initial.white)
  const [black, setBlack]           = useState(initial.black)
  const [whiteEloStr, setWhiteElo]  = useState(initial.whiteElo != null ? String(initial.whiteElo) : '')
  const [blackEloStr, setBlackElo]  = useState(initial.blackElo != null ? String(initial.blackElo) : '')
  const [result, setResult]         = useState(initial.result)
  const [date, setDate]             = useState(initial.date)
  const [event, setEvent]           = useState(initial.event)
  const [site, setSite]             = useState(initial.site)
  const [round, setRound]           = useState(initial.round)
  const [eco, setEco]               = useState(initial.eco)
  const [openingName, setOpening]   = useState(initial.opening)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  function parseElo(s: string): number | null {
    const n = parseInt(s, 10)
    return s.trim() === '' || isNaN(n) ? null : n
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const input: GameMetadataInput = {
        white,
        black,
        whiteElo: parseElo(whiteEloStr),
        blackElo: parseElo(blackEloStr),
        result,
        date,
        event,
        site,
        round,
        eco,
        opening: openingName,
      }
      await api.updateGameMetadata(gameId, input)
      onSaved(input)
      close()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={formLabel}>White Elo</label>
            <input
              className={formInput}
              type="number"
              value={whiteEloStr}
              onChange={e => setWhiteElo(e.target.value)}
              placeholder="e.g. 2700"
            />
          </div>
          <div>
            <label className={formLabel}>Black Elo</label>
            <input
              className={formInput}
              type="number"
              value={blackEloStr}
              onChange={e => setBlackElo(e.target.value)}
              placeholder="e.g. 2700"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={formLabel}>Result</label>
            <Select value={result} onValueChange={setResult} options={RESULT_OPTIONS} />
          </div>
          <div>
            <label className={formLabel}>Date</label>
            <input
              className={formInput}
              value={date}
              onChange={e => setDate(e.target.value)}
              placeholder="YYYY.MM.DD"
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

        <div>
          <label className={formLabel}>Site</label>
          <input
            className={formInput}
            value={site}
            onChange={e => setSite(e.target.value)}
            placeholder="City or URL"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={formLabel}>Round</label>
            <input
              className={formInput}
              value={round}
              onChange={e => setRound(e.target.value)}
              placeholder="e.g. 1"
            />
          </div>
          <div>
            <label className={formLabel}>ECO</label>
            <input
              className={formInput}
              value={eco}
              onChange={e => setEco(e.target.value)}
              placeholder="e.g. C60"
            />
          </div>
        </div>

        <div>
          <label className={formLabel}>Opening</label>
          <input
            className={formInput}
            value={openingName}
            onChange={e => setOpening(e.target.value)}
            placeholder="Leave blank to auto-classify from moves"
          />
        </div>

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

export default function EditMetadataDialog(props: EditMetadataDialogProps) {
  return (
    <Dialog onClose={props.onClose} title="Edit Game Info">
      <EditMetadataForm {...props} />
    </Dialog>
  )
}

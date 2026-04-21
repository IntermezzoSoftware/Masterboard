import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Plus, Trash2, Pencil, Play, RotateCcw, ChevronDown, Download } from 'lucide-react'
import { api, type Repertoire, type RepertoireMove, type DrillScope } from '@/lib/api'
import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { btnPrimary, btnSecondary, btnGhost, btnDanger, btnWhiteSide, btnBlackSide, btnTitlebarPrimary, btnTitlebarSecondary, btnTitlebarWhiteSide, btnTitlebarBlackSide, formInput, formLabel, menuContent, menuItemNormal, menuSeparator } from '@/lib/classNames'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal, TitlebarToolbarLeftPortal, useTitlebar } from '@/context/TitlebarContext'
import { ExportPolyglotDialog } from '@/components/ExportPolyglotDialog'
import { ImportStudyDialog } from '@/components/ImportStudyDialog'
import { useToast } from '@/context/ToastContext'

function scopeLabel(scope: DrillScope): string {
  if (scope.colour === 'white') return 'white'
  if (scope.colour === 'black') return 'black'
  return 'all'
}

interface ResetConfirmDialogProps {
  scope: DrillScope
  onConfirm: () => void
  onClose: () => void
}

function ResetConfirmFooter({ onConfirm }: { onConfirm: () => void }) {
  const close = useDialogClose()
  return (
    <div className="flex justify-end gap-2">
      <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
      <button className={btnDanger} onClick={() => { onConfirm(); close() }}>Reset</button>
    </div>
  )
}

function ResetConfirmDialog({ scope, onConfirm, onClose }: ResetConfirmDialogProps) {
  const label = scopeLabel(scope)
  return (
    <Dialog onClose={onClose} title="Reset drill progress" maxWidth="xs">
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          {label === 'all'
            ? 'Reset all drill progress? All moves will be due immediately and their review schedules discarded.'
            : `Reset ${label} drill progress? All ${label} moves will be due immediately and their review schedules discarded.`
          }
        </p>
        <ResetConfirmFooter onConfirm={onConfirm} />
      </div>
    </Dialog>
  )
}

interface ResetMenuProps {
  hasWhite: boolean
  hasBlack: boolean
  onRequestReset: (scope: DrillScope) => void
}

function ResetMenu({ hasWhite, hasBlack, onRequestReset }: ResetMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={`${btnGhost} active:!scale-100 data-[state=open]:bg-[var(--color-surface-2)] dark:data-[state=open]:bg-[var(--color-dark-surface-2)]`}>
          <RotateCcw size={13} />
          Reset
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={menuContent}>
          {hasWhite && hasBlack && (
            <>
              <DropdownMenu.Item className={menuItemNormal} onSelect={() => onRequestReset({})}>
                Reset All
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={menuSeparator} />
            </>
          )}
          {hasWhite && (
            <DropdownMenu.Item className={menuItemNormal} onSelect={() => onRequestReset({ colour: 'white' })}>
              Reset White
            </DropdownMenu.Item>
          )}
          {hasBlack && (
            <DropdownMenu.Item className={menuItemNormal} onSelect={() => onRequestReset({ colour: 'black' })}>
              Reset Black
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

interface CreateDialogProps {
  onClose: () => void
  onCreate: (name: string, colour: 'white' | 'black') => Promise<void>
}

function CreateRepertoireForm({ onCreate }: { onCreate: (name: string, colour: 'white' | 'black') => Promise<void> }) {
  const close = useDialogClose()
  const [name, setName]       = useState('')
  const [colour, setColour]   = useState<'white' | 'black'>('white')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Name is required.'); return }
    setSaving(true)
    try {
      await onCreate(trimmed, colour)
      close()
    } catch {
      setError('Failed to create repertoire.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
        <div>
          <label className={formLabel}>Name</label>
          <input
            ref={inputRef}
            className={formInput}
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="e.g. Ruy Lopez"
          />
        </div>
        <div>
          <label className={formLabel}>Colour</label>
          <div className="flex mt-1 rounded border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] overflow-hidden w-fit">
            {(['white', 'black'] as const).map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => setColour(c)}
                className={[
                  'px-5 py-1.5 text-sm font-medium select-none transition-colors',
                  i === 0 ? '' : 'border-l border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
                  colour === c
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-transparent text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
                ].join(' ')}
              >
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild><button type="button" className={btnGhost}>Cancel</button></DialogClose>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
  )
}

function CreateRepertoireDialog({ onClose, onCreate }: CreateDialogProps) {
  return (
    <Dialog onClose={onClose} title="New Repertoire">
      <CreateRepertoireForm onCreate={onCreate} />
    </Dialog>
  )
}

interface RepertoireRowProps {
  repertoire: Repertoire
  drillCount: number | undefined
  reviewAllCount: number | undefined
  onDelete: (id: string) => void
  onRename: (id: string, newName: string) => Promise<void>
  onTrain: (id: string) => void
  onReset: (id: string) => void
  onReviewAll: (id: string) => void
  onExportBin: (rep: Repertoire) => void
  onExportPGN: (rep: Repertoire) => void
}

function RepertoireRow({ repertoire: r, drillCount, reviewAllCount, onDelete, onRename, onTrain, onReset, onReviewAll, onExportBin, onExportPGN }: RepertoireRowProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming]           = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [isEditing, setIsEditing]             = useState(false)
  const [editName, setEditName]     = useState(r.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const committed = useRef(false)

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing) {
      committed.current = false
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isEditing])

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setEditName(r.name)
    setIsEditing(true)
  }

  async function commitEdit(value: string) {
    if (committed.current) return
    committed.current = true
    setIsEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== r.name) {
      await onRename(r.id, trimmed)
    }
  }

  function cancelEdit() {
    committed.current = true
    setIsEditing(false)
    setEditName(r.name)
  }

  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors group cursor-pointer"
      onClick={() => !isEditing && navigate('/openings/' + r.id)}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Colour pip */}
        <span className={`shrink-0 inline-block w-2.5 h-2.5 rounded-full border border-gray-500 dark:border-gray-400 ${
          r.colour === 'white' ? 'bg-white' : 'bg-neutral-900'
        }`} />
        {isEditing ? (
          <input
            ref={inputRef}
            data-testid="repertoire-rename-input"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onClick={e => e.stopPropagation()}
            onBlur={e => commitEdit(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(editName) }
              if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
            }}
            className="flex-1 min-w-0 text-sm px-1 py-0 rounded border border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] focus:outline-none"
          />
        ) : (
          <span className="text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] truncate">
            {r.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {confirming ? (
          <>
            <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mr-1">Delete?</span>
            <button className={btnDanger} onClick={e => { e.stopPropagation(); onDelete(r.id) }}>Yes</button>
            <button className={btnGhost} onClick={e => { e.stopPropagation(); setConfirming(false) }}>No</button>
          </>
        ) : confirmingReset ? (
          <>
            <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mr-1">Reset progress?</span>
            <button className={btnDanger} onClick={e => { e.stopPropagation(); setConfirmingReset(false); onReset(r.id) }}>Yes</button>
            <button className={btnGhost} onClick={e => { e.stopPropagation(); setConfirmingReset(false) }}>No</button>
          </>
        ) : (
          <>
            <button
              className={btnPrimary}
              aria-label={`Train ${r.name}`}
              title="Start drill session"
              onClick={e => { e.stopPropagation(); onTrain(r.id) }}
            >
              <Play size={12} />
              {drillCount !== undefined ? `Train (${drillCount})` : 'Train'}
            </button>
            <button
              className={btnSecondary}
              aria-label={`Review all moves in ${r.name}`}
              title="Review all moves regardless of schedule"
              onClick={e => { e.stopPropagation(); onReviewAll(r.id) }}
            >
              {reviewAllCount !== undefined ? `Review All (${reviewAllCount})` : 'Review All'}
            </button>
            <button
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
              aria-label={`Reset drill progress for ${r.name}`}
              title="Reset drill progress"
              onClick={e => { e.stopPropagation(); setConfirmingReset(true) }}
            >
              <RotateCcw size={12} />
            </button>
            <button
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
              aria-label={`Rename ${r.name}`}
              title="Rename"
              onClick={startEdit}
            >
              <Pencil size={12} />
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="p-1 rounded-[var(--radius-sm)] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
                  aria-label={`Export ${r.name}`}
                  title="Export"
                  onClick={e => e.stopPropagation()}
                >
                  <Download size={12} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4} className={menuContent} onClick={e => e.stopPropagation()}>
                  <DropdownMenu.Item className={menuItemNormal} onSelect={() => onExportPGN(r)}>Export PGN…</DropdownMenu.Item>
                  <DropdownMenu.Item className={menuItemNormal} onSelect={() => onExportBin(r)}>Export Polyglot .bin…</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <button
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-red-600 dark:hover:text-red-400 transition-colors"
              aria-label={`Delete ${r.name}`}
              title="Delete"
              onClick={e => { e.stopPropagation(); setConfirming(true) }}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function OpeningsPage() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [repertoires, setRepertoires]       = useState<Repertoire[]>([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState('')
  const [creating, setCreating]             = useState(false)
  const [showStudyDialog, setShowStudyDialog] = useState(false)
  const [pendingReset, setPendingReset]     = useState<DrillScope | null>(null)
  const [drillCounts, setDrillCounts]           = useState<Record<string, number>>({})
  const [reviewAllCounts, setReviewAllCounts]   = useState<Record<string, number>>({})
  const [exportTarget, setExportTarget]         = useState<Repertoire | null>(null)
  const [exportMoves, setExportMoves]           = useState<RepertoireMove[] | null>(null)

  async function handleExportPGN(rep: Repertoire) {
    await api.exportRepertoireToPGN(rep.id)
  }

  const loadCounts = useCallback(async (reps: Repertoire[]) => {
    if (reps.length === 0) return
    const [dueCounts, allCounts] = await Promise.all([
      Promise.all(reps.map(r => api.getDrillCount({ repertoireId: r.id }).then(n => [r.id, n] as const))),
      Promise.all(reps.map(r => api.getDrillCount({ repertoireId: r.id, ignoreSchedule: true }).then(n => [r.id, n] as const))),
    ])
    setDrillCounts(Object.fromEntries(dueCounts))
    setReviewAllCounts(Object.fromEntries(allCounts))
  }, [])

  const load = useCallback(async () => {
    try {
      const list = await api.listRepertoires()
      const reps = list ?? []
      setRepertoires(reps)
      await loadCounts(reps)
    } catch {
      setError('Failed to load repertoires.')
    } finally {
      setLoading(false)
    }
  }, [loadCounts])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!exportTarget) { setExportMoves(null); return }
    api.loadRepertoire(exportTarget.id).then(data => setExportMoves(data?.moves ?? []))
  }, [exportTarget])

  async function handleCreate(name: string, colour: 'white' | 'black') {
    await api.createRepertoire(name, colour)
    await load()
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteRepertoire(id)
      setRepertoires(prev => prev.filter(r => r.id !== id))
    } catch {
      setError('Failed to delete repertoire.')
    }
  }

  async function handleRename(id: string, newName: string) {
    try {
      await api.renameRepertoire(id, newName)
      setRepertoires(prev => prev.map(r => r.id === id ? { ...r, name: newName } : r))
    } catch {
      setError('Failed to rename repertoire.')
    }
  }

  function handleTrain(repertoireId: string) {
    navigate('/openings/drill', { state: { scope: { repertoireId }, returnTo: '/openings' } })
  }

  function handleReviewAll(repertoireId: string) {
    navigate('/openings/drill', { state: { scope: { repertoireId, ignoreSchedule: true }, returnTo: '/openings' } })
  }

  function handleTrainAll() {
    navigate('/openings/drill', { state: { scope: {}, returnTo: '/openings' } })
  }

  function handleTrainColour(colour: 'white' | 'black') {
    navigate('/openings/drill', { state: { scope: { colour }, returnTo: '/openings' } })
  }

  async function handleReset(scope: DrillScope) {
    try {
      await api.resetDrillScope(scope)
      await loadCounts(repertoires)
    } catch { /* ignore */ }
  }

  function handleResetRepertoire(repertoireId: string) {
    void handleReset({ repertoireId })
  }

  function handleRequestReset(scope: DrillScope) {
    setPendingReset(scope)
  }

  const white = repertoires.filter(r => r.colour === 'white')
  const black = repertoires.filter(r => r.colour === 'black')
  const countFor = (reps: Repertoire[]) => reps.reduce((sum, r) => sum + (drillCounts[r.id] ?? 0), 0)
  const countAll   = countFor(repertoires)
  const countWhite = countFor(white)
  const countBlack = countFor(black)

  useTitlebarBreadcrumb([])
  const { compact } = useTitlebar()

  return (
    <>
    <TitlebarToolbarLeftPortal>
      {!loading && !error && repertoires.length > 0 && (
        <>
          {white.length > 0 && black.length > 0 && (
            <button
              className={compact ? btnTitlebarPrimary : `${btnTitlebarPrimary} w-[9.75rem] justify-center`}
              title={compact ? `Train All (${countAll})` : undefined}
              onClick={handleTrainAll}
            >
              <Play size={13} />
              {!compact && `Train All (${countAll})`}
            </button>
          )}
          {white.length > 0 && (
            <button
              className={compact ? btnTitlebarWhiteSide : `${btnTitlebarWhiteSide} w-[9.75rem] justify-center`}
              title={compact ? `Train White (${countWhite})` : undefined}
              onClick={() => handleTrainColour('white')}
            >
              <Play size={13} />
              {!compact && `Train White (${countWhite})`}
            </button>
          )}
          {black.length > 0 && (
            <button
              className={compact ? btnTitlebarBlackSide : `${btnTitlebarBlackSide} w-[9.75rem] justify-center`}
              title={compact ? `Train Black (${countBlack})` : undefined}
              onClick={() => handleTrainColour('black')}
            >
              <Play size={13} />
              {!compact && `Train Black (${countBlack})`}
            </button>
          )}
          <ResetMenu hasWhite={white.length > 0} hasBlack={black.length > 0} onRequestReset={handleRequestReset} />
        </>
      )}
    </TitlebarToolbarLeftPortal>
    <TitlebarToolbarPortal>
      <button className={btnTitlebarSecondary} onClick={() => setShowStudyDialog(true)}>
        <Download size={13} />
        {!compact && 'Import Study'}
      </button>
      <button className={btnTitlebarSecondary} onClick={() => setCreating(true)}>
        <Plus size={13} />
        {!compact && 'New Repertoire'}
      </button>
    </TitlebarToolbarPortal>
    <div className="flex flex-col gap-0 h-full overflow-hidden">
      <>
      {/* Body — wrapped in a pr-1.5 gutter so the scroll container's
          scrollbar doesn't sit flush with the window edge and swallow the
          mouse events Wails's frameless-resize handler needs. */}
      <div className="flex-1 min-h-0 pr-1.5">
      <div className="h-full overflow-y-auto px-6 py-4">
        {loading && (
          <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            Loading…
          </p>
        )}
        {!loading && error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {!loading && !error && repertoires.length === 0 && (
          <div className="flex items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] py-24">
            <div className="text-center">
              <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                No repertoires yet.
              </p>
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-1">
                Create one to start building your opening book.
              </p>
            </div>
          </div>
        )}
        {!loading && !error && repertoires.length > 0 && (
          <div className="flex flex-col gap-3 max-w-lg">
            {white.length > 0 && (
              <section>
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mb-1">
                  White
                </h2>
                <div className="flex flex-col">
                  {white.map(r => (
                    <RepertoireRow key={r.id} repertoire={r} drillCount={drillCounts[r.id]} reviewAllCount={reviewAllCounts[r.id]} onDelete={handleDelete} onRename={handleRename} onTrain={handleTrain} onReset={handleResetRepertoire} onReviewAll={handleReviewAll} onExportBin={setExportTarget} onExportPGN={handleExportPGN} />
                  ))}
                </div>
              </section>
            )}
            {black.length > 0 && (
              <section>
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mb-1">
                  Black
                </h2>
                <div className="flex flex-col">
                  {black.map(r => (
                    <RepertoireRow key={r.id} repertoire={r} drillCount={drillCounts[r.id]} reviewAllCount={reviewAllCounts[r.id]} onDelete={handleDelete} onRename={handleRename} onTrain={handleTrain} onReset={handleResetRepertoire} onReviewAll={handleReviewAll} onExportBin={setExportTarget} onExportPGN={handleExportPGN} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      </div>{/* end body gutter */}

      {creating && (
        <CreateRepertoireDialog
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
        />
      )}
      {pendingReset !== null && (
        <ResetConfirmDialog
          scope={pendingReset}
          onConfirm={() => void handleReset(pendingReset)}
          onClose={() => setPendingReset(null)}
        />
      )}
      {exportTarget && exportMoves && (
        <ExportPolyglotDialog
          repertoireId={exportTarget.id}
          repertoireName={exportTarget.name}
          moves={exportMoves}
          onClose={() => setExportTarget(null)}
        />
      )}
      {showStudyDialog && (
        <ImportStudyDialog
          defaultDestination="repertoire"
          repertoires={repertoires}
          onImported={(result, repertoireId) => {
            setShowStudyDialog(false)
            load()
            if (repertoireId) {
              navigate('/openings/' + repertoireId)
            } else {
              showToast(`Imported ${result.chaptersImported} chapter${result.chaptersImported === 1 ? '' : 's'}`)
            }
          }}
          onClose={() => setShowStudyDialog(false)}
        />
      )}
      </>
    </div>
    </>
  )
}

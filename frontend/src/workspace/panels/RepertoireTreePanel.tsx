import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, ChevronRight, Upload } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { api, type Repertoire, type RepertoireMove } from '@/lib/api'
import { positionFen } from '@/lib/fenUtils'
import {
  menuContent, menuItemNormal, menuItemCompact, menuItemDestructive,
  menuItemActive, menuSeparator, btnGhost, btnPrimary,
} from '@/lib/classNames'
import { useRepertoireBuilderContext } from '@/context/RepertoireBuilderContext'
import type { HeatmapEntry } from '@/lib/api'
import { useSettings } from '@/hooks/useSettings'
import { useToast } from '@/context/ToastContext'
import { Dialog, DialogClose } from '@/components/Dialog'
import { PanelHeaderActionsPortal } from '@/workspace/PanelHeaderContext'


interface ImportPGNDialogProps {
  onClose: () => void
  onImport: (pgn: string) => Promise<number>
}

function ImportPGNDialog({ onClose, onImport }: ImportPGNDialogProps) {
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<string | null>(null)

  async function handleImport() {
    setImporting(true)
    try {
      const pgn = await api.openAndReadPGNFile()
      if (!pgn) { setImporting(false); return }
      const count = await onImport(pgn)
      setResult(count > 0
        ? `Imported ${count} new move${count === 1 ? '' : 's'}.`
        : 'No new moves to import — all moves already in the repertoire.')
    } catch {
      setResult('Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog title="Import PGN" onClose={onClose} maxWidth="sm">
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          Select a <code className="font-mono">.pgn</code> file to import into this repertoire.
          Existing moves are not duplicated.
        </p>
        {result && (
          <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            {result}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild><button className={btnGhost}>
            {result ? 'Close' : 'Cancel'}
          </button></DialogClose>
          {!result && (
            <button onClick={handleImport} disabled={importing} className={btnPrimary}>
              {importing ? 'Importing…' : 'Select .pgn file…'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function ImportHeaderMenu({ onImportPGN, onImportBin }: { onImportPGN: () => void; onImportBin: () => void }) {
  const btnCls = [
    'flex items-center gap-1 px-1.5 h-5 rounded-[var(--radius-sm)] text-xs transition-colors cursor-pointer',
    'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]',
    'hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]',
    'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
    'data-[state=open]:text-[var(--color-content-primary)] dark:data-[state=open]:text-[var(--color-dark-content-primary)]',
    'data-[state=open]:bg-[var(--color-surface-2)] dark:data-[state=open]:bg-[var(--color-dark-surface-2)]',
  ].join(' ')
  return (
    <PanelHeaderActionsPortal>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={btnCls} aria-label="Import">
            <Upload size={10} strokeWidth={2} />
            Import
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className={menuContent}>
            <DropdownMenu.Item className={menuItemCompact} onSelect={onImportPGN}>Import PGN…</DropdownMenu.Item>
            <DropdownMenu.Separator className={menuSeparator} />
            <DropdownMenu.Item className={menuItemCompact} onSelect={onImportBin}>Import Polyglot .bin…</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </PanelHeaderActionsPortal>
  )
}


interface ImportPolyglotDialogProps {
  onClose: () => void
  onImport: () => Promise<number>
}

function ImportPolyglotDialog({ onClose, onImport }: ImportPolyglotDialogProps) {
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<string | null>(null)

  async function handleImport() {
    setImporting(true)
    try {
      const count = await onImport()
      if (count === -1) {
        // User cancelled the file picker — leave dialog open
        setImporting(false)
        return
      }
      setResult(count > 0
        ? `Imported ${count} new move${count === 1 ? '' : 's'}.`
        : 'No new moves found in book.')
    } catch {
      setResult('Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog title="Import Polyglot Book" onClose={onClose} maxWidth="md">
      <div className="p-4 flex flex-col gap-3">
        <p className={[
          'text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]',
        ].join(' ')}>
          Polyglot books store only move statistics — annotations, comments, and NAGs are not preserved.
        </p>
        {result && (
          <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            {result}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild><button className={btnGhost}>
            {result ? 'Close' : 'Cancel'}
          </button></DialogClose>
          {!result && (
            <button
              onClick={handleImport}
              disabled={importing}
              className={btnPrimary}
            >
              {importing ? 'Importing…' : 'Select .bin file…'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}


const NAG_SYMBOL: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!',
}

const NAG_OPTIONS = [
  { nag: 1, symbol: '!',  label: 'Good move'   },
  { nag: 2, symbol: '?',  label: 'Mistake'     },
  { nag: 3, symbol: '!!', label: 'Brilliant'   },
  { nag: 4, symbol: '??', label: 'Blunder'     },
  { nag: 5, symbol: '!?', label: 'Interesting' },
  { nag: 6, symbol: '?!', label: 'Dubious'     },
]


function moveSide(move: RepertoireMove): 'white' | 'black' {
  return move.fromFen.split(' ')[1] === 'w' ? 'white' : 'black'
}

function moveNumber(move: RepertoireMove): number {
  return parseInt(move.fromFen.split(' ')[5] ?? '1', 10)
}


function CommentEditor({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initialText)

  useEffect(() => {
    const id = window.setTimeout(() => { ref.current?.focus() }, 0)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <textarea
      ref={ref}
      value={text}
      rows={2}
      onChange={e => setText(e.target.value)}
      onBlur={() => onSave(text)}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(text) }
      }}
      aria-label="Move comment"
      className={[
        'w-full text-xs font-sans not-italic resize-none rounded-[var(--radius-sm)] px-2 py-1 mt-0.5',
        'border border-[var(--color-accent)] dark:border-[var(--color-dark-accent)]',
        'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
        'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
        'focus:outline-none',
      ].join(' ')}
      placeholder="Add a comment…"
    />
  )
}


function RepertoireSubMenu({
  label,
  copyTargets,
  onSelect,
}: {
  label: string
  copyTargets: Repertoire[]
  onSelect: (repId: string) => void
}) {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger
        className={[
          menuItemNormal,
          'flex items-center justify-between',
          'data-[state=open]:bg-[var(--color-surface-2)] dark:data-[state=open]:bg-[var(--color-dark-surface-2)]',
        ].join(' ')}
      >
        {label}
        <span className="ml-3 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] select-none">›</span>
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className={menuContent}>
          {copyTargets.map(r => (
            <ContextMenu.Item
              key={r.id}
              className={menuItemNormal}
              onSelect={() => onSelect(r.id)}
            >
              <span className="flex items-center gap-2">
                <span className={[
                  'shrink-0 inline-block w-2 h-2 rounded-full border border-gray-400 dark:border-gray-500',
                  r.colour === 'white' ? 'bg-white' : 'bg-neutral-900',
                ].join(' ')} />
                {r.name}
              </span>
            </ContextMenu.Item>
          ))}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  )
}


function heatmapDotClass(entry: HeatmapEntry | undefined): string | null {
  if (!entry || entry.state === 0) return null
  // State=3 (Relearning): card was previously mastered but lapsed.
  if (entry.state === 3) return 'bg-red-500'
  // State=1 (Learning): card not yet graduated regardless of retrievability,
  // which reads ~1.0 immediately after any review and would misleadingly show green.
  if (entry.state === 1) return 'bg-yellow-400'
  // State=2 (Review): graduated card — use retrievability to show decay.
  if (entry.retrievability >= 0.9) return 'bg-green-500'
  if (entry.retrievability >= 0.7) return 'bg-yellow-400'
  return 'bg-red-500'
}


interface MoveTokenProps {
  move: RepertoireMove
  isActive: boolean
  activeRef: React.RefObject<HTMLButtonElement | null>
  onNavigateTo: (move: RepertoireMove) => void
  onDeleteMove: (moveId: string) => void
  onUpdateAnnotation: (moveId: string, nag: number | null, comment: string) => void
  onStartEdit: (moveId: string, text: string) => void
  copyTargets: Repertoire[]
  onAddPathToRepertoire: (moveId: string, targetRepId: string) => void
  onAddBranchToRepertoire: (moveId: string, targetRepId: string) => void
  heatmap: Map<string, HeatmapEntry> | null
  onDrillBranch: (moveId: string) => void
  canReorder?: boolean
  onReorderUp?: () => void
  onReorderDown?: () => void
}

function MoveToken({
  move, isActive, activeRef,
  onNavigateTo, onDeleteMove, onUpdateAnnotation, onStartEdit,
  copyTargets, onAddPathToRepertoire, onAddBranchToRepertoire,
  heatmap, onDrillBranch,
  canReorder, onReorderUp, onReorderDown,
}: MoveTokenProps) {
  const dotClass = heatmapDotClass(heatmap?.get(move.id))
  const pendingCommentFocus = useRef(false)

  const nagItems = NAG_OPTIONS.map(({ nag, symbol, label }) => (
    <ContextMenu.Item
      key={nag}
      className={move.nag === nag ? menuItemActive : menuItemNormal}
      onSelect={() => onUpdateAnnotation(move.id, move.nag === nag ? null : nag, move.comment)}
    >
      <span className="inline-block w-5 font-mono">{symbol}</span>
      {label}
    </ContextMenu.Item>
  ))

  return (
    <span className="inline-flex items-baseline gap-0.5">
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          ref={isActive ? activeRef : undefined}
          onClick={e => { onNavigateTo(move); e.currentTarget.blur() }}
          className={[
            'px-1.5 py-0.5 rounded-[var(--radius-sm)] text-sm transition-colors',
            isActive
              ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] font-semibold'
              : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer',
          ].join(' ')}
        >
          {move.moveSan}
          {move.nag !== null && (
            <span className="ml-0.5 text-xs">
              {NAG_SYMBOL[move.nag] ?? `$${move.nag}`}
            </span>
          )}
          {dotClass && (
            <span className={`inline-block w-1.5 h-1.5 rounded-full ml-0.5 align-middle ${dotClass}`} />
          )}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={menuContent}
          onCloseAutoFocus={e => {
            if (pendingCommentFocus.current) {
              e.preventDefault()
              pendingCommentFocus.current = false
            }
          }}
        >
          {nagItems}
          <div className={menuSeparator} />
          <ContextMenu.Item
            className={menuItemNormal}
            onPointerDown={() => { pendingCommentFocus.current = true }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') pendingCommentFocus.current = true }}
            onSelect={() => onStartEdit(move.id, move.comment)}
          >
            {move.comment ? 'Edit comment' : 'Add comment'}
          </ContextMenu.Item>
          {move.comment ? (
            <ContextMenu.Item
              className={menuItemNormal}
              onSelect={() => onUpdateAnnotation(move.id, move.nag, '')}
            >
              Clear comment
            </ContextMenu.Item>
          ) : null}
          {copyTargets.length > 0 && (
            <>
              <div className={menuSeparator} />
              <RepertoireSubMenu
                label="Add to repertoire"
                copyTargets={copyTargets}
                onSelect={repId => onAddPathToRepertoire(move.id, repId)}
              />
              <RepertoireSubMenu
                label="Add branch to repertoire"
                copyTargets={copyTargets}
                onSelect={repId => onAddBranchToRepertoire(move.id, repId)}
              />
            </>
          )}
          <div className={menuSeparator} />
          <ContextMenu.Item
            className={`${menuItemNormal} flex items-center gap-1.5`}
            onSelect={() => onDrillBranch(move.id)}
          >
            <Play size={11} />
            Train branch
          </ContextMenu.Item>
          {canReorder && (
            <>
              <div className={menuSeparator} />
              <ContextMenu.Item className={menuItemNormal} onSelect={onReorderUp}>
                Move branch up
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemNormal} onSelect={onReorderDown}>
                Move branch down
              </ContextMenu.Item>
            </>
          )}
          <div className={menuSeparator} />
          <ContextMenu.Item
            className={menuItemDestructive}
            onSelect={() => onDeleteMove(move.id)}
          >
            Delete branch
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    </span>
  )
}


interface BranchProps {
  startMove: RepertoireMove
  depth: number
  allMoves: RepertoireMove[]
  currentMoveId: string | null
  activeRef: React.RefObject<HTMLButtonElement | null>
  onNavigateTo: (move: RepertoireMove) => void
  onDeleteMove: (moveId: string) => void
  onUpdateAnnotation: (moveId: string, nag: number | null, comment: string) => void
  editingMoveId: string | null
  onStartEdit: (moveId: string, text: string) => void
  onFinishEdit: (moveId: string, text: string) => void
  onCancelEdit: () => void
  collapsed: Set<string>
  onToggleCollapse: (moveId: string) => void
  copyTargets: Repertoire[]
  onAddPathToRepertoire: (moveId: string, targetRepId: string) => void
  onAddBranchToRepertoire: (moveId: string, targetRepId: string) => void
  heatmap: Map<string, HeatmapEntry> | null
  onDrillBranch: (moveId: string) => void
  reorderSiblings: (moveId: string, direction: 'up' | 'down') => void
}

function Branch({
  startMove, depth, allMoves, currentMoveId, activeRef,
  onNavigateTo, onDeleteMove, onUpdateAnnotation,
  editingMoveId, onStartEdit, onFinishEdit, onCancelEdit,
  collapsed, onToggleCollapse,
  copyTargets, onAddPathToRepertoire, onAddBranchToRepertoire,
  heatmap, onDrillBranch, reorderSiblings,
}: BranchProps) {
  const isCollapsed = collapsed.has(startMove.id)

  const siblings = useMemo(
    () => allMoves
      .filter(m => m.parentId === startMove.parentId && m.fromFen === startMove.fromFen)
      .sort((a, b) => a.moveOrder - b.moveOrder),
    [allMoves, startMove]
  )
  const hasSiblings = siblings.length > 1

  const sequence: RepertoireMove[] = []
  let cur: RepertoireMove = startMove

  // Walk down the main line until we hit a branch point, no children, or a transposition
  while (true) {
    sequence.push(cur)
    if (cur.isTransposition) break
    const kids = allMoves
      .filter(m => m.parentId === cur.id)
      .sort((a, b) => a.moveOrder - b.moveOrder)
    if (kids.length === 1) {
      cur = kids[0]
    } else {
      break
    }
  }

  const lastMove = sequence[sequence.length - 1]
  const children = lastMove.isTransposition
    ? []
    : allMoves
        .filter(m => m.parentId === lastMove.id)
        .sort((a, b) => a.moveOrder - b.moveOrder)

  const sharedBranchProps = {
    allMoves, currentMoveId, activeRef,
    onNavigateTo, onDeleteMove, onUpdateAnnotation,
    editingMoveId, onStartEdit, onFinishEdit, onCancelEdit,
    collapsed, onToggleCollapse,
    copyTargets, onAddPathToRepertoire, onAddBranchToRepertoire,
    heatmap, onDrillBranch, reorderSiblings,
  }

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 16 + 8 }}
        className="flex flex-wrap items-baseline gap-x-0.5 py-0.5"
      >
        {/* Collapse toggle — shown on all alternative branches (depth > 0) */}
        {depth > 0 && (
          <button
            onClick={() => onToggleCollapse(startMove.id)}
            className="mr-0.5 flex items-center text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] select-none cursor-pointer"
            aria-label={isCollapsed ? 'Expand branch' : 'Collapse branch'}
            title={isCollapsed ? 'Expand branch' : 'Collapse branch'}
          >
            <ChevronRight size={11} className={isCollapsed ? 'transition-transform' : 'rotate-90 transition-transform'} />
          </button>
        )}
        {(isCollapsed ? sequence.slice(0, 1) : sequence).map((move, idx) => {
          const side = moveSide(move)
          const num  = moveNumber(move)
          const prev = idx > 0 ? sequence[idx - 1] : null
          // The inline editor is a basis-full block that breaks the flex row, so
          // the next move starts a new line and needs its number prefix restored.
          const prevWasEditing = !isCollapsed && prev !== null && editingMoveId === prev.id
          const showNum    = side === 'white' || idx === 0 || prevWasEditing
          const isEditing  = !isCollapsed && editingMoveId === move.id
          const hasComment = !isCollapsed && !isEditing && !!move.comment

          return (
            <Fragment key={move.id}>
              {showNum && (
                <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] select-none">
                  {num}{side === 'white' ? '.' : '...'}
                </span>
              )}
              <MoveToken
                move={move}
                isActive={move.id === currentMoveId}
                activeRef={activeRef}
                onNavigateTo={onNavigateTo}
                onDeleteMove={onDeleteMove}
                onUpdateAnnotation={onUpdateAnnotation}
                onStartEdit={onStartEdit}
                copyTargets={copyTargets}
                onAddPathToRepertoire={onAddPathToRepertoire}
                onAddBranchToRepertoire={onAddBranchToRepertoire}
                heatmap={heatmap}
                onDrillBranch={onDrillBranch}
                canReorder={idx === 0 && depth > 0 && hasSiblings}
                onReorderUp={() => reorderSiblings(startMove.id, 'up')}
                onReorderDown={() => reorderSiblings(startMove.id, 'down')}
              />
              {/* Comments render inline with the move sequence (PGN style) so
                  each comment sits directly after the move it annotates and
                  flex-wrap flows them naturally with the surrounding moves. */}
              {hasComment && (
                <span
                  key={`${move.id}-comment`}
                  className="mx-1 text-xs italic text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]"
                >
                  {move.comment}
                </span>
              )}
              {/* Editing uses a basis-full block so the textarea can size
                  itself; this is a transient state while the user is typing. */}
              {isEditing && (
                <div key={`${move.id}-editor`} className="basis-full w-full pr-2 pt-0.5 pb-1">
                  <CommentEditor
                    initialText={move.comment}
                    onSave={text => onFinishEdit(move.id, text)}
                    onCancel={onCancelEdit}
                  />
                </div>
              )}
            </Fragment>
          )
        })}
        {/* Transposition indicator — shown after the last move in this branch */}
        {lastMove.isTransposition && (() => {
          const canonical = allMoves.find(m => positionFen(m.toFen) === positionFen(lastMove.toFen) && !m.isTransposition)
          return (
            <button
              onClick={canonical ? () => onNavigateTo(canonical) : undefined}
              className={[
                'text-xs italic select-none',
                canonical
                  ? 'text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline cursor-pointer'
                  : 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] cursor-default',
              ].join(' ')}
              title={canonical ? 'Click to jump to the transposition target' : 'This line transposes to another branch'}
            >
              ⇄ transposes
            </button>
          )
        })()}
        {/* Collapsed ellipsis — shown after the first move when branch is collapsed */}
        {depth > 0 && isCollapsed && (
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] select-none">…</span>
        )}
      </div>

      {!isCollapsed && children.map(child => (
        <Branch
          key={child.id}
          startMove={child}
          depth={depth + 1}
          {...sharedBranchProps}
        />
      ))}
    </div>
  )
}


export default function RepertoireTreePanel() {
  const { moves, currentMoveId, navigateTo, deleteMove, updateAnnotation, heatmap, repertoire, importPGN, importPolyglotBook, reorderSiblings } =
    useRepertoireBuilderContext()
  const { values: uiSettings } = useSettings(['repertoire.showHeatmap'])
  const showHeatmap = uiSettings['repertoire.showHeatmap'] !== 'false'
  const showToast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [showImport, setShowImport]       = useState(false)
  const [showImportBin, setShowImportBin] = useState(false)
  const [editingMoveId, setEditingMoveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [allRepertoires, setAllRepertoires] = useState<Repertoire[]>([])
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    api.listRepertoires()
      .then(list => setAllRepertoires(list ?? []))
      .catch(() => {})
  }, [])

  const toggleCollapse = useCallback((moveId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(moveId)) { next.delete(moveId) } else { next.add(moveId) }
      return next
    })
  }, [])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentMoveId])

  // Repertoires available as copy targets — exclude the one currently open
  const currentRepertoireId = moves[0]?.repertoireId ?? null
  const copyTargets = allRepertoires.filter(r => r.id !== currentRepertoireId)

  // Shared dedup+save logic used by both copy operations.
  async function copyMovesToRepertoire(chain: RepertoireMove[], targetRepertoireId: string) {
    let existingMoves: RepertoireMove[]
    try {
      const data = await api.loadRepertoire(targetRepertoireId)
      existingMoves = data?.moves ?? []
    } catch {
      showToast('Failed to load repertoire.', 'error')
      return
    }

    const existingSet    = new Set(existingMoves.map(m => `${m.fromFen}|${m.moveUci}`))
    const toFenToId      = new Map(existingMoves.map(m => [m.toFen, m.id] as [string, string]))
    const existingToFens = new Set(existingMoves.map(m => m.toFen))

    let saved = 0
    for (const move of chain) {
      const key = `${move.fromFen}|${move.moveUci}`
      if (existingSet.has(key)) continue

      const parentId  = toFenToId.get(move.fromFen) ?? null
      const moveOrder = [...existingSet].filter(k => k.startsWith(move.fromFen + '|')).length

      const newMove: RepertoireMove = {
        id: '', repertoireId: targetRepertoireId, parentId,
        fromFen: move.fromFen, toFen: move.toFen,
        moveSan: move.moveSan, moveUci: move.moveUci, moveOrder,
        nag: null, comment: '', shapes: '', isTransposition: false,
      }

      try {
        const savedId = await api.saveRepertoireMove(newMove)
        existingSet.add(key)
        if (!existingToFens.has(move.toFen)) {
          toFenToId.set(move.toFen, savedId)
          existingToFens.add(move.toFen)
        }
        saved++
      } catch {
        // non-fatal — continue with the rest
      }
    }

    const repName = allRepertoires.find(r => r.id === targetRepertoireId)?.name ?? 'repertoire'
    if (saved === 0) {
      showToast(`Already in ${repName}.`)
    } else {
      showToast(`Added ${saved} move${saved === 1 ? '' : 's'} to ${repName}.`)
    }
  }

  async function addPathToRepertoire(moveId: string, targetRepertoireId: string) {
    const chain: RepertoireMove[] = []
    let cur: RepertoireMove | undefined = moves.find(m => m.id === moveId)
    while (cur) {
      chain.push(cur)
      const parentId = cur.parentId
      cur = parentId ? moves.find(m => m.id === parentId) : undefined
    }
    chain.reverse()
    await copyMovesToRepertoire(chain, targetRepertoireId)
  }

  // Subtree copy prevents a disconnected branch in the target repertoire.
  async function addBranchToRepertoire(moveId: string, targetRepertoireId: string) {
    // Ancestors: path from root up to (not including) the clicked move
    const ancestors: RepertoireMove[] = []
    const clickedMove = moves.find(m => m.id === moveId)
    if (!clickedMove) return
    let anc: RepertoireMove | undefined = clickedMove.parentId
      ? moves.find(m => m.id === clickedMove.parentId)
      : undefined
    while (anc) {
      ancestors.push(anc)
      const parentId = anc.parentId
      anc = parentId ? moves.find(m => m.id === parentId) : undefined
    }
    ancestors.reverse()

    // Subtree: BFS from clicked move (preserves parent-before-child order)
    const subtree: RepertoireMove[] = []
    const queue: string[] = [moveId]
    while (queue.length > 0) {
      const id = queue.shift()!
      const move = moves.find(m => m.id === id)
      if (!move) continue
      subtree.push(move)
      const children = moves
        .filter(m => m.parentId === id)
        .sort((a, b) => a.moveOrder - b.moveOrder)
      queue.push(...children.map(c => c.id))
    }

    await copyMovesToRepertoire([...ancestors, ...subtree], targetRepertoireId)
  }

  const rootMoves = moves
    .filter(m => m.parentId === null)
    .sort((a, b) => a.moveOrder - b.moveOrder)

  const drillBranch = useCallback((moveId: string) => {
    const repertoireId = repertoire?.id ?? moves[0]?.repertoireId
    if (!repertoireId) return
    navigate('/openings/drill', {
      state: {
        scope: { repertoireId, rootMoveId: moveId },
        returnTo: location.pathname,
      },
    })
  }, [repertoire, moves, navigate, location.pathname])

  if (rootMoves.length === 0) {
    return (
      <div
        data-testid="repertoire-tree"
        className="h-full flex flex-col"
      >
        <ImportHeaderMenu onImportPGN={() => setShowImport(true)} onImportBin={() => setShowImportBin(true)} />
        <div className="flex-1 flex items-center justify-center p-3 text-center text-14 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
          Play a move on the board to start building your repertoire.
        </div>
        {showImport && (
          <ImportPGNDialog onClose={() => setShowImport(false)} onImport={importPGN} />
        )}
        {showImportBin && (
          <ImportPolyglotDialog onClose={() => setShowImportBin(false)} onImport={importPolyglotBook} />
        )}
      </div>
    )
  }

  const sharedProps = {
    allMoves: moves,
    currentMoveId,
    activeRef,
    onNavigateTo: navigateTo,
    onDeleteMove: deleteMove,
    onUpdateAnnotation: updateAnnotation,
    editingMoveId,
    onStartEdit: (moveId: string, text: string) => { void text; setEditingMoveId(moveId) },
    onFinishEdit: (moveId: string, text: string) => {
      const move = moves.find(m => m.id === moveId)
      if (move) updateAnnotation(moveId, move.nag, text)
      setEditingMoveId(null)
    },
    onCancelEdit: () => setEditingMoveId(null),
    collapsed,
    onToggleCollapse: toggleCollapse,
    copyTargets,
    onAddPathToRepertoire: addPathToRepertoire,
    onAddBranchToRepertoire: addBranchToRepertoire,
    heatmap: showHeatmap ? heatmap : null,
    onDrillBranch: drillBranch,
    reorderSiblings,
  }

  return (
    <div
      data-testid="repertoire-tree"
      className="h-full overflow-auto py-1"
    >
      <ImportHeaderMenu onImportPGN={() => setShowImport(true)} onImportBin={() => setShowImportBin(true)} />
      {rootMoves.map(rootMove => (
        <Branch
          key={rootMove.id}
          startMove={rootMove}
          depth={0}
          {...sharedProps}
        />
      ))}
      {showImport && (
        <ImportPGNDialog onClose={() => setShowImport(false)} onImport={importPGN} />
      )}
      {showImportBin && (
        <ImportPolyglotDialog onClose={() => setShowImportBin(false)} onImport={importPolyglotBook} />
      )}
    </div>
  )
}

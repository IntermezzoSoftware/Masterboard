import { useEffect, useRef, useState } from 'react'
import { FilePlus, Save, Copy, ClipboardPaste, ChevronDown, FileText, LayoutGrid } from 'lucide-react'
import type { PanelId } from './types'
import { PANEL_DEFS } from './panelRegistry'
import { btnToolbar, menuItemDropdown } from '@/lib/classNames'
import { useTitlebar } from '@/context/TitlebarContext'


interface WorkspaceActionsProps {
  onNewGame: () => void
  onSaveGame: () => void
  onSaveAsGame: () => void
  hasSavedGame: boolean
  hasGame: boolean
  onCopyFen: () => void
  onImportFen: () => void
  onEditPosition: () => void
  onCopyPgn: () => void
  onImportPgn: () => void
  onEditMetadata: () => void
}

export function WorkspaceActions({
  onNewGame, onSaveGame, onSaveAsGame, hasSavedGame, hasGame,
  onCopyFen, onImportFen, onEditPosition, onCopyPgn, onImportPgn, onEditMetadata,
}: WorkspaceActionsProps) {
  const { compact } = useTitlebar()
  const [newOpen,  setNewOpen]  = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [fenOpen,  setFenOpen]  = useState(false)
  const [pgnOpen,  setPgnOpen]  = useState(false)
  const newRef  = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLDivElement>(null)
  const fenRef  = useRef<HTMLDivElement>(null)
  const pgnRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!newOpen && !saveOpen && !fenOpen && !pgnOpen) return
    function handleClick(e: MouseEvent) {
      if (newOpen  && newRef.current  && !newRef.current.contains(e.target as Node))   setNewOpen(false)
      if (saveOpen && saveRef.current && !saveRef.current.contains(e.target as Node))  setSaveOpen(false)
      if (fenOpen  && fenRef.current  && !fenRef.current.contains(e.target as Node))   setFenOpen(false)
      if (pgnOpen  && pgnRef.current  && !pgnRef.current.contains(e.target as Node))   setPgnOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [newOpen, saveOpen, fenOpen, pgnOpen])

  function handleCopyFen() {
    setFenOpen(false)
    onCopyFen()
  }

  function handleCopyPgn() {
    setPgnOpen(false)
    onCopyPgn()
  }

  return (
    <>
      {/* New — dropdown: new game or set up position */}
      <div ref={newRef} className="relative">
        <button
          onClick={() => setNewOpen(o => !o)}
          aria-label="New"
          title="New"
          className={btnToolbar}
        >
          <FilePlus size={12} strokeWidth={1.75} aria-hidden="true" />
          {!compact && 'New'}
          <ChevronDown size={10} aria-hidden="true" className={newOpen ? 'rotate-180' : ''} style={{ transition: 'transform 0.15s' }} />
        </button>
        {newOpen && (
          <div className="absolute left-0 top-full mt-1 w-44 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-lg z-20 py-1 overflow-hidden">
            <button className={menuItemDropdown} onClick={() => { setNewOpen(false); onNewGame() }}>
              <FilePlus size={11} strokeWidth={1.75} aria-hidden="true" />
              New Game
            </button>
            <button className={menuItemDropdown} onClick={() => { setNewOpen(false); onEditPosition() }}>
              <LayoutGrid size={11} strokeWidth={1.75} aria-hidden="true" />
              Set Up Position…
            </button>
          </div>
        )}
      </div>

      {/* Save — dropdown only when a saved game is loaded */}
      <div ref={saveRef} className="relative">
        <button
          onClick={() => hasGame && (hasSavedGame ? setSaveOpen(o => !o) : onSaveGame())}
          aria-label="Save game"
          title="Save game"
          disabled={!hasGame}
          className={`${btnToolbar} disabled:opacity-40 disabled:pointer-events-none`}
        >
          <Save size={12} strokeWidth={1.75} aria-hidden="true" />
          {!compact && 'Save'}
          {hasSavedGame && (
            <ChevronDown size={10} aria-hidden="true" className={saveOpen ? 'rotate-180' : ''} style={{ transition: 'transform 0.15s' }} />
          )}
        </button>
        {saveOpen && (
          <div className="absolute left-0 top-full mt-1 w-32 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-lg z-20 py-1 overflow-hidden">
            <button className={menuItemDropdown} onClick={() => { setSaveOpen(false); onSaveGame() }}>Save</button>
            <button className={menuItemDropdown} onClick={() => { setSaveOpen(false); onSaveAsGame() }}>Save As…</button>
            <button className={menuItemDropdown} onClick={() => { setSaveOpen(false); onEditMetadata() }}>Edit Metadata…</button>
          </div>
        )}
      </div>

      {/* FEN — dropdown: copy or load position */}
      <div ref={fenRef} className="relative">
        <button
          onClick={() => setFenOpen(o => !o)}
          aria-label="FEN"
          title="FEN"
          className={btnToolbar}
        >
          <Copy size={12} strokeWidth={1.75} aria-hidden="true" />
          {!compact && 'FEN'}
          <ChevronDown size={10} aria-hidden="true" className={fenOpen ? 'rotate-180' : ''} style={{ transition: 'transform 0.15s' }} />
        </button>
        {fenOpen && (
          <div className="absolute left-0 top-full mt-1 w-40 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-lg z-20 py-1 overflow-hidden">
            <button className={menuItemDropdown} onClick={handleCopyFen}>
              <Copy size={11} strokeWidth={1.75} aria-hidden="true" />
              Copy FEN
            </button>
            <button className={menuItemDropdown} onClick={() => { setFenOpen(false); onImportFen() }}>
              <ClipboardPaste size={11} strokeWidth={1.75} aria-hidden="true" />
              Load Position…
            </button>
          </div>
        )}
      </div>

      {/* PGN — dropdown: copy or import */}
      <div ref={pgnRef} className="relative">
        <button
          onClick={() => setPgnOpen(o => !o)}
          aria-label="PGN"
          title="PGN"
          className={btnToolbar}
        >
          <FileText size={12} strokeWidth={1.75} aria-hidden="true" />
          {!compact && 'PGN'}
          <ChevronDown size={10} aria-hidden="true" className={pgnOpen ? 'rotate-180' : ''} style={{ transition: 'transform 0.15s' }} />
        </button>
        {pgnOpen && (
          <div className="absolute left-0 top-full mt-1 w-40 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-lg z-20 py-1 overflow-hidden">
            <button className={menuItemDropdown} onClick={handleCopyPgn}>
              <Copy size={11} strokeWidth={1.75} aria-hidden="true" />
              Copy PGN
            </button>
            <button className={menuItemDropdown} onClick={() => { setPgnOpen(false); onImportPgn() }}>
              <ClipboardPaste size={11} strokeWidth={1.75} aria-hidden="true" />
              Load Game...
            </button>
          </div>
        )}
      </div>
    </>
  )
}


interface PanelTogglesProps {
  panelIds: readonly PanelId[]
  activeIds: Set<PanelId>
  totalPanelCount: number
  onAdd: (id: PanelId) => void
  onRemove: (id: PanelId) => void
}

export function PanelToggles({ panelIds, activeIds, totalPanelCount, onAdd, onRemove }: PanelTogglesProps) {
  const { compact } = useTitlebar()
  return (
    <>
      {panelIds.map(id => {
        const def = PANEL_DEFS[id]
        const isActive = activeIds.has(id)
        const isDisabled = isActive && totalPanelCount <= 1

        return (
          <button
            key={id}
            onClick={() => isActive ? onRemove(id) : onAdd(id)}
            disabled={isDisabled}
            aria-pressed={isActive}
            aria-label={isActive ? `Hide ${def.label}` : `Show ${def.label}`}
            title={compact ? def.label : undefined}
            className={[
              'flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors',
              isDisabled
                ? 'opacity-40 cursor-default'
                : 'cursor-pointer',
              isActive
                ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
                : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
            ].join(' ')}
          >
            <def.icon size={12} strokeWidth={1.75} aria-hidden="true" />
            {!compact && def.label}
          </button>
        )
      })}
    </>
  )
}

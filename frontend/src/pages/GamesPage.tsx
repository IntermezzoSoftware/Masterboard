import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Search, RefreshCw, Trash2, Download, ClipboardList, FolderInput, BarChart2, CheckCircle2, Loader2, AlertCircle, ChevronDown, ChevronUp, ChevronRight, Columns2, GripVertical, Swords } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api, type Collection, type Folder, type GameSummary } from '@/lib/api'
import { EventsOn } from '@/lib/wailsRuntime'
import { useSettings } from '@/hooks/useSettings'
import { formatTimeControl } from '@/lib/gameFormatters'
import { ResultBadge } from '@/components/ResultBadge'
import { ImportMenu } from '@/components/ImportMenu'
import { ImportPlatformDialog } from '@/components/ImportPlatformDialog'
import { ImportStudyDialog } from '@/components/ImportStudyDialog'
import { ConfirmBulkDeleteDialog } from '@/components/ConfirmBulkDeleteDialog'
import { AssignCollectionsPopover } from '@/components/AssignCollectionsPopover'
import FolderTree, { type FolderSelection } from '@/components/FolderTree'
import MoveFolderDialog from '@/components/MoveFolderDialog'
import { Dialog, DialogClose } from '@/components/Dialog'
import { Checkbox } from '@/components/Checkbox'
import { useToast } from '@/context/ToastContext'
import { useVirtualizer } from '@tanstack/react-virtual'
import { btnSecondary, btnDanger, btnGhost, btnTitlebarSecondary, btnTitlebarDanger, menuContent, menuItemNormal, menuItemDestructive, menuSeparator, collectionToggle, collectionToggleActive } from '@/lib/classNames'
import { Select } from '@/components/Select'
import { DatePicker } from '@/components/DatePicker'
import { useColumnResize } from '@/hooks/useColumnResize'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal } from '@/context/TitlebarContext'
import GtmStartDialog from '@/components/GtmStartDialog'

const QUICK_SYNC_MAX_GAMES = 20

// Default max games for the quick-sync shortcut path into the import dialog
const QUICK_SYNC_DEFAULT = String(QUICK_SYNC_MAX_GAMES)

type SortKey = 'date' | 'white' | 'black' | 'result' | 'event' | 'eco'

type ColKey = 'white' | 'black' | 'result' | 'date' | 'event' | 'eco' | 'tc' | 'source' | 'analysis' | 'collections'

const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  white: 130, black: 130, result: 70, date: 95, event: 160, eco: 55, tc: 75, source: 105, analysis: 40, collections: 150,
}

// Ordered list of resizable columns — used to find the adjacent column to steal from
const COL_ORDER: ColKey[] = ['white', 'black', 'result', 'date', 'event', 'eco', 'tc', 'source', 'analysis', 'collections']

const COL_LABELS: Record<ColKey, string> = {
  white: 'White', black: 'Black', result: 'Result', date: 'Date',
  event: 'Event', eco: 'ECO', tc: 'Time Control', source: 'Source',
  analysis: 'Analysed', collections: 'Collections',
}

const DEFAULT_COL_VISIBILITY: Record<ColKey, boolean> = {
  white: true, black: true, result: true, date: true, event: true,
  eco: true, tc: true, source: true, analysis: true, collections: true,
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', lichess: 'Lichess', chesscom: 'Chess.com', pgn_import: 'PGN import',
}

const COL_VISIBILITY_LS_KEY = 'masterboard.gamesColVisibility'
const COL_ORDER_LS_KEY = 'masterboard.gamesColOrder'

const SORT_COL_SET = new Set<ColKey>(['white', 'black', 'result', 'date', 'event', 'eco'])

const TIME_CONTROL_FILTER_OPTIONS = [
  { value: 'bullet',    label: 'Bullet'    },
  { value: 'blitz',     label: 'Blitz'     },
  { value: 'rapid',     label: 'Rapid'     },
  { value: 'classical', label: 'Classical' },
  { value: 'other',     label: 'Other'     },
]

interface Filters {
  player: string
  result: string
  source: string
  collectionId: string
  dateFrom: string
  dateTo: string
  timeControls: string[]
}

interface SavedViewState {
  filters: Filters
  folderSelection: FolderSelection
  sortKey: SortKey
  sortAsc: boolean
  myselfActive: boolean
}

let savedViewState: SavedViewState | null = null
let savedFolderOpenState: Record<string, boolean> = {}

type DialogState =
  | { type: 'none' }
  | { type: 'lichess';  initialUsername?: string; initialMaxGames?: string; autoFetch?: boolean }
  | { type: 'chesscom'; initialUsername?: string; initialMaxGames?: string; autoFetch?: boolean }
  | { type: 'bulkDelete' }
  | { type: 'gtm'; gameId: string }

function SortableColItem({ col, visible, onToggle }: { col: ColKey; visible: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-0.5 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-secondary)] dark:hover:text-[var(--color-dark-content-secondary)]"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical size={10} />
      </button>
      <label className="flex items-center gap-2 cursor-pointer flex-1">
        <Checkbox checked={visible} onCheckedChange={() => onToggle()} />
        {COL_LABELS[col]}
      </label>
    </div>
  )
}

export default function GamesPage() {
  const navigate = useNavigate()
  const [games, setGames]         = useState<GameSummary[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [filters, setFilters]     = useState<Filters>(
    savedViewState?.filters ?? { player: '', result: '', source: '', collectionId: '', dateFrom: '', dateTo: '', timeControls: [] }
  )
  const [collections, setCollections] = useState<Collection[]>([])
  const [folders, setFolders]     = useState<Folder[]>([])
  const [folderSelection, setFolderSelection] = useState<FolderSelection>(
    savedViewState?.folderSelection ?? { type: 'all' }
  )
  const [sortKey, setSortKey]     = useState<SortKey>(savedViewState?.sortKey ?? 'date')
  const [sortAsc, setSortAsc]     = useState(savedViewState?.sortAsc ?? false)
  const [dialog, setDialog]       = useState<DialogState>({ type: 'none' })
  const [showStudyDialog, setShowStudyDialog] = useState(false)
  const showToast = useToast()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [identityNames, setIdentityNames] = useState<string[] | null>(null)
  const [myselfActive, setMyselfActive]   = useState(savedViewState?.myselfActive ?? false)
  const [filtersOpen, setFiltersOpen]     = useState(true)
  // movingIds: game IDs being moved to a folder; null means dialog closed
  const [movingIds, setMovingIds] = useState<string[] | null>(null)
  const [collectionsGameId, setCollectionsGameId] = useState<string | null>(null)
  // deletingFolderId: folder being confirmed for deletion; null means dialog closed
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)
  const [colOrder, setColOrder] = useState<ColKey[]>(() => {
    try {
      const stored = localStorage.getItem(COL_ORDER_LS_KEY)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          const known = new Set(COL_ORDER)
          const filtered = (parsed as string[]).filter(k => known.has(k as ColKey)) as ColKey[]
          const missing = COL_ORDER.filter(k => !filtered.includes(k))
          return [...filtered, ...missing]
        }
      }
    } catch { /* fall through */ }
    return [...COL_ORDER]
  })

  const [colVisibility, setColVisibility] = useState<Record<ColKey, boolean>>(() => {
    try {
      const stored = localStorage.getItem(COL_VISIBILITY_LS_KEY)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') return { ...DEFAULT_COL_VISIBILITY, ...(parsed as Partial<Record<ColKey, boolean>>) }
      }
    } catch { /* fall through */ }
    return DEFAULT_COL_VISIBILITY
  })

  function toggleColVisibility(col: ColKey) {
    setColVisibility(prev => {
      const next = { ...prev, [col]: !prev[col] }
      try { localStorage.setItem(COL_VISIBILITY_LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const colDndSensors = useSensors(useSensor(PointerSensor))

  function handleColDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setColOrder(prev => {
      const oldIndex = prev.indexOf(active.id as ColKey)
      const newIndex = prev.indexOf(over.id as ColKey)
      const next = arrayMove(prev, oldIndex, newIndex)
      try { localStorage.setItem(COL_ORDER_LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const visibleColOrder = colOrder.filter(k => colVisibility[k])

  const { colWidths, setColWidths, tableRef, startResize } = useColumnResize(
    COL_ORDER, DEFAULT_COL_WIDTHS, 'masterboard.gamesColWidths', { fixedPx: 96, activeColOrder: visibleColOrder },
  )

  const { values: savedSettings } = useSettings(['lichess.username', 'chesscom.username'])
  const lichessUsername  = savedSettings['lichess.username']  ?? ''
  const chesscomUsername = savedSettings['chesscom.username'] ?? ''

  const loadCollections = useCallback(async () => {
    try {
      const cols = await api.listCollections()
      setCollections(cols ?? [])
    } catch {
      // Non-fatal — collection filter just won't populate
    }
  }, [])

  const loadFolders = useCallback(async () => {
    try {
      const fols = await api.listFolders()
      setFolders(fols ?? [])
    } catch {
      // Non-fatal — folder tree just won't populate
    }
  }, [])

  useEffect(() => { loadCollections(); loadFolders() }, [loadCollections, loadFolders])

  useEffect(() => {
    savedViewState = { filters, folderSelection, sortKey, sortAsc, myselfActive }
  }, [filters, folderSelection, sortKey, sortAsc, myselfActive])

  useEffect(() => {
    api.getIdentityNames().then(names => setIdentityNames(names ?? [])).catch(() => setIdentityNames([]))
  }, [])

  const loadGames = useCallback(async (opts?: { keepSelection?: boolean }) => {
    if (identityNames === null) return
    setLoading(true)
    setError('')
    try {
      const data = await api.listGames({
        player:            myselfActive ? undefined : (filters.player || undefined),
        playerNames:       myselfActive ? identityNames : undefined,
        result:            filters.result       || undefined,
        source:            filters.source       || undefined,
        collectionId:      filters.collectionId || undefined,
        dateFrom:          filters.dateFrom      || undefined,
        dateTo:            filters.dateTo        || undefined,
        timeControls:      filters.timeControls.length > 0 ? filters.timeControls : undefined,
        folderId:          folderSelection.type === 'folder' ? folderSelection.id : undefined,
        includeSubfolders: folderSelection.type === 'folder' ? true : undefined,
        unfiled:           folderSelection.type === 'unfiled' ? true : undefined,
        limit:             -1,
      })
      setGames(data ?? [])
      if (!opts?.keepSelection) setSelectedIds(new Set())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load games')
    } finally {
      setLoading(false)
    }
  }, [filters, folderSelection, myselfActive, identityNames])

  useEffect(() => { loadGames() }, [loadGames])

  const handleCollectionsChanged = useCallback(() => {
    loadGames()
    loadCollections()
  }, [loadGames, loadCollections])

  // Refresh game list when analyses complete (updates status column, preserves selection)
  useEffect(() => {
    const unsub = EventsOn('analysis:complete', () => { loadGames({ keepSelection: true }) })
    return unsub
  }, [loadGames])

  // Sort
  const sorted = useMemo(() => [...games].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'date')   cmp = a.date.localeCompare(b.date)
    if (sortKey === 'white')  cmp = a.white.localeCompare(b.white)
    if (sortKey === 'black')  cmp = a.black.localeCompare(b.black)
    if (sortKey === 'result') cmp = a.result.localeCompare(b.result)
    if (sortKey === 'event')  cmp = a.event.localeCompare(b.event)
    if (sortKey === 'eco')    cmp = a.eco.localeCompare(b.eco)
    return sortAsc ? cmp : -cmp
  }), [games, sortKey, sortAsc])

  // Virtualization
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [headerPr, setHeaderPr] = useState(12)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const measure = () => setHeaderPr(el.offsetWidth - el.clientWidth + 6)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading]) // re-run when table mounts/unmounts
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 33,
    overscan: 20,
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  // Selection helpers
  const allVisibleSelected = sorted.length > 0 && sorted.every(g => selectedIds.has(g.id))
  const someSelected       = selectedIds.size > 0 && !allVisibleSelected

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sorted.map(g => g.id)))
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleMoveToFolder(folderId: string | null) {
    const ids = movingIds ?? []
    try {
      await Promise.all(ids.map(id => api.moveGameToFolder(id, folderId)))
      loadGames()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Move failed')
    }
  }

  async function handleCreateFolder(name: string, parentId: string | null) {
    await api.createFolder(name, parentId)
    loadFolders()
  }

  async function handleRenameFolder(id: string, name: string) {
    await api.renameFolder(id, name)
    loadFolders()
  }

  function handleDeleteFolder(id: string) {
    setDeletingFolderId(id)
  }

  function afterFolderDeleted(id: string) {
    loadFolders()
    loadGames()
    if (folderSelection.type === 'folder' && folderSelection.id === id) {
      setFolderSelection({ type: 'all' })
    }
  }

  async function confirmDeleteFolderOnly() {
    if (!deletingFolderId) return
    const id = deletingFolderId
    try {
      await api.deleteFolder(id)
      afterFolderDeleted(id)
    } catch (e: unknown) {
      setDeletingFolderId(null)
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function confirmDeleteFolderWithGames() {
    if (!deletingFolderId) return
    const id = deletingFolderId
    try {
      await api.deleteFolderWithGames(id)
      afterFolderDeleted(id)
    } catch (e: unknown) {
      setDeletingFolderId(null)
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map(id => api.deleteGame(id)))
      setGames(prev => prev.filter(g => !selectedIds.has(g.id)))
      setSelectedIds(new Set())
      showToast(`Deleted ${ids.length} game${ids.length === 1 ? '' : 's'}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handlePGNFile() {
    try {
      const path = await api.openFileDialog()
      if (!path) return
      const ids = await api.importPGNFile(path)
      if (folderSelection.type === 'folder' && ids.length > 0) {
        await Promise.all(ids.map(id => api.moveGameToFolder(id, folderSelection.id)))
      }
      if (filters.collectionId && ids.length > 0) {
        await Promise.all(ids.map(id => api.addGameToCollection(id, filters.collectionId)))
      }
      showToast(`Imported ${ids.length} game${ids.length === 1 ? '' : 's'}`)
      loadGames()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  async function handlePGNFolder() {
    try {
      const dir = await api.openDirectoryDialog()
      if (!dir) return
      const ids = await api.importPGNFolder(dir)
      if (folderSelection.type === 'folder' && ids.length > 0) {
        await Promise.all(ids.map(id => api.moveGameToFolder(id, folderSelection.id)))
      }
      if (filters.collectionId && ids.length > 0) {
        await Promise.all(ids.map(id => api.addGameToCollection(id, filters.collectionId)))
      }
      showToast(`Imported ${ids.length} game${ids.length === 1 ? '' : 's'}`)
      loadGames()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    }
  }


  function handleImported(count: number, duplicates: number) {
    let msg: string
    if (count === 0 && duplicates > 0) {
      msg = `All ${duplicates} game${duplicates === 1 ? '' : 's'} already in library`
    } else if (duplicates > 0) {
      msg = `Imported ${count} new game${count === 1 ? '' : 's'} · ${duplicates} already in library`
    } else {
      msg = `Imported ${count} new game${count === 1 ? '' : 's'}`
    }
    showToast(msg)
    loadGames()
  }

  function openGame(game: GameSummary) {
    navigate('/board', { state: { gameId: game.id } })
  }

  const thClass = (_key: SortKey) =>
    `relative px-3 py-2 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]`

  const thStaticClass = 'relative px-3 py-2 text-left text-xs font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]'

  const rHandle = (col: ColKey) => {
    if (visibleColOrder.indexOf(col) >= visibleColOrder.length - 1) return null
    return (
      <div
        className="group absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-10"
        onMouseDown={e => { e.stopPropagation(); startResize(col, e) }}
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] opacity-0 group-hover:opacity-100 group-active:opacity-100" />
      </div>
    )
  }

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null
    const Icon = sortAsc ? ChevronUp : ChevronDown
    return <Icon size={10} className="inline align-middle ml-0.5 shrink-0" aria-hidden="true" />
  }

  // Percentage widths keep the table exactly w-full regardless of pixel sum.
  // Fixed columns (checkbox=32, actions=70) are included in the denominator.
  const totalUnits = 64 + visibleColOrder.reduce((a, k) => a + colWidths[k], 0)
  const pct = (w: number) => `${(w / totalUnits * 100).toFixed(3)}%`

  useTitlebarBreadcrumb([])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]">
      <TitlebarToolbarPortal>
        {lichessUsername && (
          <button
            onClick={() => setDialog({ type: 'lichess', initialUsername: lichessUsername, initialMaxGames: QUICK_SYNC_DEFAULT, autoFetch: true })}
            title={`Import recent Lichess games for ${lichessUsername}`}
            className={btnTitlebarSecondary}
          >
            <Download size={11} aria-hidden="true" />
            Lichess
          </button>
        )}
        {chesscomUsername && (
          <button
            onClick={() => setDialog({ type: 'chesscom', initialUsername: chesscomUsername, initialMaxGames: QUICK_SYNC_DEFAULT, autoFetch: true })}
            title={`Import recent Chess.com games for ${chesscomUsername}`}
            className={btnTitlebarSecondary}
          >
            <Download size={11} aria-hidden="true" />
            Chess.com
          </button>
        )}
        <button
          onClick={() => navigate('/record')}
          className={btnTitlebarSecondary}
        >
          <ClipboardList size={12} aria-hidden="true" />
          Record
        </button>
        <ImportMenu
          onPGNFile={handlePGNFile}
          onPGNFolder={handlePGNFolder}
          onLichess={() => setDialog({ type: 'lichess' })}
          onChessCom={() => setDialog({ type: 'chesscom' })}
          onLichessStudy={() => setShowStudyDialog(true)}
        />
      </TitlebarToolbarPortal>
      {/* Main area: sidebar + right column */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar: filters + folder tree */}
        <div className="w-56 shrink-0 border-r border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] flex flex-col overflow-hidden bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]">

          {/* Filters section */}
          <div className="shrink-0 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]">
            <div className="flex items-center px-3 h-10 gap-1">
              <button
                onClick={() => setFiltersOpen(v => !v)}
                className="flex items-center gap-1 flex-1 text-xs font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
              >
                <ChevronRight size={12} className={filtersOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
                <span>Filters</span>
              </button>
              <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">
                {loading ? 'Loading…' : `${games.length.toLocaleString()} game${games.length === 1 ? '' : 's'}`}
              </span>
              <button
                onClick={() => loadGames()}
                title="Refresh"
                className="p-1 rounded-[var(--radius-sm)] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors shrink-0"
              >
                <RefreshCw size={12} />
              </button>
            </div>

            {filtersOpen && (
              <div className="px-2 pb-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <div className="relative flex-1">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]" />
                    <input
                      className="w-full pl-7 pr-2 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="Search player…"
                      value={myselfActive ? '' : filters.player}
                      onChange={e => setFilters(f => ({ ...f, player: e.target.value }))}
                      disabled={myselfActive}
                    />
                  </div>
                  <button
                    onClick={() => setMyselfActive(v => !v)}
                    disabled={(identityNames?.length ?? 0) === 0 && !myselfActive}
                    title={(identityNames?.length ?? 0) > 0 ? 'Filter by your configured identities' : 'Configure your identity in Settings to use this filter'}
                    className={`shrink-0 text-xs px-1.5 py-1.5 rounded-[var(--radius-sm)] border transition-colors ${
                      myselfActive
                        ? 'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
                        : 'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    Myself
                  </button>
                </div>

                <Select
                  value={filters.result}
                  onValueChange={v => setFilters(f => ({ ...f, result: v }))}
                  size="xs"
                  placeholder="All results"
                  options={[
                    { value: '', label: 'All results' },
                    { value: '1-0', label: '1-0' },
                    { value: '0-1', label: '0-1' },
                    { value: '1/2-1/2', label: '½-½' },
                    { value: '*', label: '*' },
                  ]}
                />

                <Select
                  value={filters.source}
                  onValueChange={v => setFilters(f => ({ ...f, source: v }))}
                  size="xs"
                  placeholder="All sources"
                  options={[
                    { value: '', label: 'All sources' },
                    { value: 'manual', label: 'Manual' },
                    { value: 'lichess', label: 'Lichess' },
                    { value: 'chesscom', label: 'Chess.com' },
                    { value: 'pgn_import', label: 'PGN import' },
                  ]}
                />

                {collections.length > 0 && (
                  <Select
                    value={filters.collectionId}
                    onValueChange={v => setFilters(f => ({ ...f, collectionId: v }))}
                    size="xs"
                    placeholder="All collections"
                    options={[
                      { value: '', label: 'All collections' },
                      ...collections.map(c => ({ value: c.id, label: c.name })),
                    ]}
                  />
                )}

                <div className="flex flex-col gap-1">
                  <DatePicker
                    value={filters.dateFrom}
                    onChange={v => setFilters(f => ({ ...f, dateFrom: v }))}
                    placeholder="From date"
                  />
                  <DatePicker
                    value={filters.dateTo}
                    onChange={v => setFilters(f => ({ ...f, dateTo: v }))}
                    placeholder="To date"
                  />
                </div>

                <div className="grid grid-cols-2 gap-1">
                  {TIME_CONTROL_FILTER_OPTIONS.map(o => {
                    const active = filters.timeControls.includes(o.value)
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setFilters(f => ({
                          ...f,
                          timeControls: active
                            ? f.timeControls.filter(v => v !== o.value)
                            : [...f.timeControls, o.value],
                        }))}
                        className={`${active ? collectionToggleActive : collectionToggle} text-center`}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>

                {(myselfActive || filters.player !== '' || filters.result !== '' || filters.source !== '' || filters.collectionId !== '' || filters.dateFrom !== '' || filters.dateTo !== '' || filters.timeControls.length > 0) && (
                  <button
                    onClick={() => { setFilters({ player: '', result: '', source: '', collectionId: '', dateFrom: '', dateTo: '', timeControls: [] }); setMyselfActive(false) }}
                    title="Clear filters"
                    className={`${btnGhost} w-full justify-center`}
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Folder tree — independently scrollable */}
          <div className="flex-1 overflow-y-auto pb-1 bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]">
            <FolderTree
              folders={folders}
              selection={folderSelection}
              onSelect={setFolderSelection}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              initialOpenState={savedFolderOpenState}
              onOpenStateChange={state => { savedFolderOpenState = state }}
            />
          </div>

        </div>

        {/* Right column: table */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Error */}
          {error && (
            <div className="mx-3 mt-2 px-3 py-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-[var(--radius-sm)] border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {/* Table area — split into fixed header + scrolling body so the
              scrollbar is contained to the tbody and we can put a 6px resize
              gutter only alongside the body (Wails's frameless-resize
              handler needs mouse events in the window-edge 6px band, which
              native scrollbars swallow). Header's pr-3 = 6px gutter + 6px
              scrollbar so its columns align with the body table's columns. */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">Loading games…</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">No games found</p>
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">Import a PGN file or fetch games from Lichess or Chess.com</p>
            </div>
          ) : (
          <>
          {/* Fixed header table */}
          <div className="shrink-0 bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]" style={{ paddingRight: headerPr }}>
          <table className="w-full text-xs border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: pct(32) }} />
              {visibleColOrder.map(k => <col key={k} style={{ width: pct(colWidths[k]) }} />)}
              <col style={{ width: pct(32) }} />
            </colgroup>
            <thead>
              {selectedIds.size > 0 ? (
                <tr className="h-10">
                  <th className="px-3 py-0 w-8 text-left">
                    <Checkbox
                      checked={someSelected ? 'indeterminate' : allVisibleSelected}
                      onCheckedChange={() => toggleSelectAll()}
                    />
                  </th>
                  <th colSpan={visibleColOrder.length + 1} className="px-3 py-0 text-left">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-medium text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]">
                          {selectedIds.size} game{selectedIds.size === 1 ? '' : 's'} selected
                        </span>
                        <button
                          onClick={() => setSelectedIds(new Set())}
                          className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
                        >
                          Deselect all
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedIds(new Set())
                            api.analyseGames(Array.from(selectedIds)).then(() => { loadGames({ keepSelection: true }) }).catch(() => {})
                          }}
                          className={btnTitlebarSecondary}
                        >
                          <BarChart2 size={11} />
                          Analyse {selectedIds.size}
                        </button>
                        <button
                          onClick={() => setMovingIds(Array.from(selectedIds))}
                          className={btnTitlebarSecondary}
                        >
                          <FolderInput size={11} />
                          Move to folder
                        </button>
                        {selectedIds.size === 1 && (
                          <button
                            onClick={() => {
                              const [gameId] = Array.from(selectedIds)
                              setDialog({ type: 'gtm', gameId })
                            }}
                            className={btnTitlebarSecondary}
                          >
                            <Swords size={11} />
                            Guess the Move
                          </button>
                        )}
                        <button
                          onClick={() => setDialog({ type: 'bulkDelete' })}
                          className={`flex items-center gap-1.5 ${btnTitlebarDanger}`}
                        >
                          <Trash2 size={11} />
                          Delete {selectedIds.size}
                        </button>
                      </div>
                    </div>
                  </th>
                </tr>
              ) : (
                <tr className="h-10">
                  <th className="px-3 py-2 w-8 text-left">
                    <Checkbox
                      checked={someSelected ? 'indeterminate' : allVisibleSelected}
                      onCheckedChange={() => toggleSelectAll()}
                    />
                  </th>
                  {colOrder.map(col => {
                    if (!colVisibility[col]) return null
                    if (SORT_COL_SET.has(col)) {
                      const sk = col as SortKey
                      return (
                        <th key={col} className={thClass(sk)} onClick={() => toggleSort(sk)}>
                          {COL_LABELS[col]}{sortIndicator(sk)}{rHandle(col)}
                        </th>
                      )
                    }
                    return (
                      <th key={col} className={thStaticClass}>
                        {col !== 'analysis' ? COL_LABELS[col] : null}{rHandle(col)}
                      </th>
                    )
                  })}
                  <th className="px-3 py-2 w-8 text-right">
                    <Popover.Root>
                      <Popover.Trigger asChild>
                        <button
                          className="align-middle p-1 rounded text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors cursor-pointer"
                          title="Show/hide columns"
                        >
                          <Columns2 size={12} aria-hidden="true" />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content align="end" sideOffset={4} className="z-50 w-48 py-1 rounded-[var(--radius-md)] shadow-lg border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]">
                          <DndContext sensors={colDndSensors} collisionDetection={closestCenter} onDragEnd={handleColDragEnd}>
                            <SortableContext items={colOrder} strategy={verticalListSortingStrategy}>
                              {colOrder.map(col => (
                                <SortableColItem
                                  key={col}
                                  col={col}
                                  visible={colVisibility[col]}
                                  onToggle={() => toggleColVisibility(col)}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </th>
                </tr>
              )}
            </thead>
          </table>
          </div>{/* end fixed header */}

          {/* Scrolling body — 6px resize gutter (pr-1.5 pb-1.5) + stable
              scrollbar gutter so the body table's content area width matches
              the header's (header pr-3 = 6px gutter + 6px scrollbar). */}
          <div className="flex-1 min-h-0 pr-1.5 pb-1.5">
          <div ref={scrollContainerRef} className="h-full overflow-auto" style={{ scrollbarGutter: 'stable' }}>
          <table ref={tableRef} className="w-full text-xs border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: pct(32) }} />
              {visibleColOrder.map(k => <col key={k} style={{ width: pct(colWidths[k]) }} />)}
              <col style={{ width: pct(32) }} />
            </colgroup>
            <tbody>
              {virtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: virtualizer.getVirtualItems()[0].start }} aria-hidden>
                  <td colSpan={visibleColOrder.length + 2} style={{ padding: 0, border: 'none' }} />
                </tr>
              )}
              {virtualizer.getVirtualItems().map(virtualRow => {
                const game = sorted[virtualRow.index]
                const isSelected = selectedIds.has(game.id)
                return (
                  <ContextMenu.Root key={game.id}>
                    <ContextMenu.Trigger asChild>
                      <tr
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        className={`border-b border-[var(--color-surface-2)] dark:border-[var(--color-dark-surface-2)] cursor-pointer transition-colors group ${isSelected ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)]' : 'hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)]'}`}
                      >
                        <td className="px-3 py-2 w-8" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectOne(game.id)}
                          />
                        </td>
                        {colOrder.map(col => {
                          if (!colVisibility[col]) return null
                          switch (col) {
                            case 'white':
                              return (
                                <td key={col} className="px-3 py-2 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium truncate" onClick={() => openGame(game)}>
                                  {game.white}{game.whiteElo ? ` (${game.whiteElo})` : ''}
                                </td>
                              )
                            case 'black':
                              return (
                                <td key={col} className="px-3 py-2 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium truncate" onClick={() => openGame(game)}>
                                  {game.black}{game.blackElo ? ` (${game.blackElo})` : ''}
                                </td>
                              )
                            case 'result':
                              return <td key={col} className="px-3 py-2 whitespace-nowrap overflow-hidden" onClick={() => openGame(game)}><ResultBadge result={game.result} /></td>
                            case 'date':
                              return <td key={col} className="px-3 py-2 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] whitespace-nowrap overflow-hidden" onClick={() => openGame(game)}>{game.date.slice(0, 10)}</td>
                            case 'event':
                              return <td key={col} className="px-3 py-2 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate" onClick={() => openGame(game)}>{game.event}</td>
                            case 'eco':
                              return <td key={col} className="px-3 py-2 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] overflow-hidden" onClick={() => openGame(game)}>{game.eco || '—'}</td>
                            case 'tc':
                              return <td key={col} className="px-3 py-2 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] overflow-hidden" onClick={() => openGame(game)}>{formatTimeControl(game.timeControl)}</td>
                            case 'source':
                              return (
                                <td key={col} className="px-3 py-2 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] overflow-hidden" onClick={() => openGame(game)}>
                                  {SOURCE_LABELS[game.source] ?? game.source}
                                </td>
                              )
                            case 'analysis':
                              return (
                                <td key={col} className="px-3 py-2 overflow-hidden" onClick={() => openGame(game)}>
                                  {game.analysisStatus === 'complete' && (
                                    <span title="Analysis complete"><CheckCircle2 size={14} className="text-green-600 dark:text-green-400" /></span>
                                  )}
                                  {(game.analysisStatus === 'running' || game.analysisStatus === 'pending') && (
                                    <span title="Analysing..."><Loader2 size={14} className="text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] animate-spin" /></span>
                                  )}
                                  {game.analysisStatus === 'error' && (
                                    <span title="Analysis failed"><AlertCircle size={14} className="text-red-600 dark:text-red-400" /></span>
                                  )}
                                </td>
                              )
                            case 'collections':
                              return (
                                <td key={col} className="px-3 py-2 overflow-hidden" onClick={() => openGame(game)}>
                                  <div className="flex flex-wrap gap-1">
                                    {(game.collectionNames ?? []).map(name => (
                                      <span
                                        key={name}
                                        className="px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] font-medium"
                                      >
                                        {name}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              )
                          }
                        })}
                        <td className="px-1 py-2">
                          <AssignCollectionsPopover
                            gameId={game.id}
                            open={collectionsGameId === game.id}
                            onOpenChange={o => { if (!o) setCollectionsGameId(null) }}
                            onChanged={handleCollectionsChanged}
                          />
                        </td>
                      </tr>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className={menuContent}>
                        <ContextMenu.Item
                          className={menuItemNormal}
                          onSelect={() => {
                            api.analyseGames([game.id]).then(() => loadGames({ keepSelection: true })).catch(() => {})
                          }}
                        >
                          Analyse
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          className={menuItemNormal}
                          onSelect={() => setMovingIds([game.id])}
                        >
                          Move to folder
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          className={menuItemNormal}
                          onSelect={() => setTimeout(() => setCollectionsGameId(game.id), 0)}
                        >
                          Assign to collections
                        </ContextMenu.Item>
                        <ContextMenu.Separator className={menuSeparator} />
                        <ContextMenu.Item
                          className={menuItemNormal}
                          onSelect={() => setDialog({ type: 'gtm', gameId: game.id })}
                        >
                          Guess the Move
                        </ContextMenu.Item>
                        <ContextMenu.Separator className={menuSeparator} />
                        <ContextMenu.Item
                          className={menuItemDestructive}
                          onSelect={() => {
                            setSelectedIds(new Set([game.id]))
                            setDialog({ type: 'bulkDelete' })
                          }}
                        >
                          Delete
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                )
              })}
              {virtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }} aria-hidden>
                  <td colSpan={visibleColOrder.length + 2} style={{ padding: 0, border: 'none' }} />
                </tr>
              )}
            </tbody>
          </table>
          </div>{/* end body scroll */}
          </div>{/* end body gutter */}
          </>
        )}
        </div>{/* end right column */}
      </div>{/* end main area */}

      {/* Dialogs */}
      {dialog.type === 'lichess' && (
        <ImportPlatformDialog platform="lichess" initialUsername={dialog.initialUsername ?? lichessUsername} initialMaxGames={dialog.initialMaxGames} autoFetch={dialog.autoFetch} folders={folders} collections={collections} initialFolderId={folderSelection.type === 'folder' ? folderSelection.id : null} onImported={handleImported} onClose={() => setDialog({ type: 'none' })} />
      )}
      {dialog.type === 'chesscom' && (
        <ImportPlatformDialog platform="chesscom" initialUsername={dialog.initialUsername ?? chesscomUsername} initialMaxGames={dialog.initialMaxGames} autoFetch={dialog.autoFetch} folders={folders} collections={collections} initialFolderId={folderSelection.type === 'folder' ? folderSelection.id : null} onImported={handleImported} onClose={() => setDialog({ type: 'none' })} />
      )}
      {dialog.type === 'bulkDelete' && (
        <ConfirmBulkDeleteDialog
          count={selectedIds.size}
          onConfirm={handleBulkDelete}
          onClose={() => setDialog({ type: 'none' })}
        />
      )}
      {movingIds !== null && (
        <MoveFolderDialog
          gameCount={movingIds.length}
          folders={folders}
          onMove={handleMoveToFolder}
          onClose={() => setMovingIds(null)}
        />
      )}
      {dialog.type === 'gtm' && (
        <GtmStartDialog gameId={dialog.gameId} onClose={() => setDialog({ type: 'none' })} />
      )}
      {deletingFolderId !== null && (
        <Dialog title="Delete folder?" onClose={() => setDeletingFolderId(null)} maxWidth="xs">
          <div className="px-4 py-4 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            What should happen to the games inside this folder?
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
            <DialogClose asChild><button onClick={confirmDeleteFolderOnly} className={btnSecondary}>Keep games</button></DialogClose>
            <DialogClose asChild><button onClick={confirmDeleteFolderWithGames} className={btnDanger}>Delete games</button></DialogClose>
          </div>
        </Dialog>
      )}
      {showStudyDialog && (
        <ImportStudyDialog
          defaultDestination="games"
          folders={folders}
          onImported={(result) => {
            setShowStudyDialog(false)
            showToast(`Imported ${result.gamesImported} game${result.gamesImported === 1 ? '' : 's'}`)
            loadGames()
          }}
          onClose={() => setShowStudyDialog(false)}
        />
      )}
    </div>
  )
}

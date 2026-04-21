import { useEffect, useState } from 'react'
import { useNavBlur } from '@/hooks/useNavBlur'
import { useNavigate } from 'react-router'
import { ArrowLeft, RotateCcw, Save } from 'lucide-react'
import { ChessGameProvider } from '@/context/ChessGameContext'
import { useChessGameContext } from '@/context/ChessGameContext'
import { api, type Collection, type Folder, type GameInput } from '@/lib/api'
import { Select } from '@/components/Select'
import { formInput, formLabel, btnSecondary, btnPrimary, btnTitlebarGhost, collectionToggle, collectionToggleActive } from '@/lib/classNames'

const RESULT_OPTIONS = [
  { value: '*', label: '* (ongoing)' },
  { value: '1-0', label: '1-0 (White wins)' },
  { value: '0-1', label: '0-1 (Black wins)' },
  { value: '1/2-1/2', label: '½-½ (Draw)' },
]
import Chessboard from '@/components/Chessboard'
import BoardControls from '@/components/BoardControls'
import MoveList from '@/components/MoveList'
import { useTitlebarBreadcrumb, TitlebarToolbarLeftPortal, useTitlebar } from '@/context/TitlebarContext'
export default function RecordPage() {
  return (
    <ChessGameProvider>
      <RecordPageContent />
    </ChessGameProvider>
  )
}

function RecordPageContent() {
  useNavBlur()
  useTitlebarBreadcrumb([{ label: 'Games', to: '/games' }, { label: 'Record' }])
  const { compact } = useTitlebar()
  const navigate = useNavigate()
  const {
    rootNode,
    currentNode,
    boardConfig,
    goBack,
    goForward,
    goToStart,
    goToEnd,
    goToNode,
    flipOrientation,
    resetGame,
    toPGN,
    deleteFrom,
    promoteVariation,
  } = useChessGameContext()

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.')

  const [white, setWhite]           = useState('')
  const [black, setBlack]           = useState('')
  const [event, setEvent]           = useState('')
  const [date, setDate]             = useState(today)
  const [result, setResult]         = useState('*')
  const [folderId, setFolderId]     = useState('')
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set())
  const [folders, setFolders]       = useState<Folder[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  useEffect(() => {
    Promise.all([api.listFolders(), api.listCollections()]).then(([f, c]) => {
      setFolders(f ?? [])
      setCollections(c ?? [])
    }).catch(() => {})
  }, [])

  function toggleCollection(id: string) {
    setSelectedCollections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleFinish() {
    setSaving(true)
    setError('')
    try {
      const pgn = toPGN({
        White:  white  || '?',
        Black:  black  || '?',
        Event:  event  || '?',
        Date:   date,
        Result: result,
      })
      const input: GameInput = {
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
      const id = await api.saveGame(input)
      if (folderId) {
        await api.moveGameToFolder(id, folderId)
      }
      if (selectedCollections.size > 0) {
        await Promise.all(
          [...selectedCollections].map(cid => api.addGameToCollection(id, cid))
        )
      }
      navigate('/games')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save game')
    } finally {
      setSaving(false)
    }
  }

  function handleNewGame() {
    resetGame({ force: true })
    setWhite('')
    setBlack('')
    setEvent('')
    setDate(new Date().toISOString().slice(0, 10).replace(/-/g, '.'))
    setResult('*')
    setFolderId('')
    setSelectedCollections(new Set())
    setError('')
  }

  return (
    <>
    <TitlebarToolbarLeftPortal>
      <button
        onClick={() => navigate('/games')}
        className={btnTitlebarGhost}
        aria-label="Back to Games"
        title={compact ? 'Back to Games' : undefined}
      >
        <ArrowLeft size={14} />
        {!compact && 'Back to Games'}
      </button>
    </TitlebarToolbarLeftPortal>
    <div className="flex h-full overflow-hidden bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]">
      {/* Board column */}
      <div className="flex flex-col items-center justify-center flex-1 min-w-0 p-6 gap-3">
        <div className="w-full max-w-[560px] aspect-square">
          <Chessboard config={boardConfig} />
        </div>
        <BoardControls
          canGoBack={currentNode.parent !== null}
          canGoForward={currentNode.children.length > 0}
          onGoBack={goBack}
          onGoForward={goForward}
          onGoToStart={goToStart}
          onGoToEnd={goToEnd}
          onFlip={flipOrientation}
        />
      </div>

      {/* Right panel */}
      <div className="flex flex-col w-72 shrink-0 border-l border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]">
        {/* Game details — non-scrolling */}
        <div className="shrink-0 px-4 py-4 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={formLabel}>White</label>
                <input className={formInput} value={white} onChange={e => setWhite(e.target.value)} placeholder="White player" />
              </div>
              <div>
                <label className={formLabel}>Black</label>
                <input className={formInput} value={black} onChange={e => setBlack(e.target.value)} placeholder="Black player" />
              </div>
            </div>
            <div>
              <label className={formLabel}>Event</label>
              <input className={formInput} value={event} onChange={e => setEvent(e.target.value)} placeholder="Tournament or event" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={formLabel}>Date</label>
                <input className={formInput} value={date} onChange={e => setDate(e.target.value)} placeholder="YYYY.MM.DD" />
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
          </div>

        {/* Move list — scrollable (MoveList itself owns the overflow-auto),
            wrapped in a pr-1.5 gutter so its scrollbar doesn't sit flush
            with the window edge and swallow the mouse events Wails's
            frameless-resize handler needs. */}
        <div className="flex-1 min-h-0 pr-1.5 flex flex-col">
          <MoveList
            rootNode={rootNode}
            currentNodeId={currentNode.id}
            onGoToNode={goToNode}
            onDeleteFrom={deleteFrom}
            onPromoteVariation={promoteVariation}
            onSetNodeNag={() => {}}
            onSetNodeComment={() => {}}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] flex gap-2">
          <button
            onClick={handleNewGame}
            className={btnSecondary}
          >
            <RotateCcw size={11} />
            New game
          </button>
          <button
            onClick={handleFinish}
            disabled={saving}
            className={`flex-1 flex items-center justify-center gap-1.5 ${btnPrimary}`}
          >
            <Save size={11} />
            {saving ? 'Saving\u2026' : 'Finish & save'}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}


import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, pointerWithin } from '@dnd-kit/core'
import { Play, RotateCcw, Eye } from 'lucide-react'
import { useRepertoireBuilder } from '@/hooks/useRepertoireBuilder'
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout'
import { useWorkspaceDnd } from '@/hooks/useWorkspaceDnd'
import { useWorkspacePanels } from '@/hooks/useWorkspacePanels'
import { RepertoireBuilderProvider } from '@/context/RepertoireBuilderContext'
import { useEngineFenOverride } from '@/context/EngineFenOverride'
import MosaicNode from '@/workspace/MosaicNode'
import { ALL_REPERTOIRE_PANEL_IDS } from '@/workspace/panelRegistry'
import { PanelToggles } from '@/workspace/WorkspaceToolbar'
import { DEFAULT_REPERTOIRE_LAYOUT } from '@/workspace/layoutOps'
import { btnTitlebarSecondary, btnTitlebarGhost, btnTitlebarPrimary, btnTitlebarDanger } from '@/lib/classNames'
import { api } from '@/lib/api'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal, TitlebarToolbarLeftPortal, useTitlebar } from '@/context/TitlebarContext'


export default function RepertoireBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [drillCount, setDrillCount]           = useState<number | null>(null)
  const [reviewAllCount, setReviewAllCount]   = useState<number | null>(null)
  const [resetConfirming, setResetConfirming] = useState(false)
  const [layout, setLayout] = useWorkspaceLayout(
    'masterboard.repertoireLayout',
    ALL_REPERTOIRE_PANEL_IDS,
    DEFAULT_REPERTOIRE_LAYOUT,
  )

  const hook = useRepertoireBuilder(id ?? '')
  const { repertoire, isLoading, error, loadHeatmap } = hook

  const location = useLocation()
  const targetFenApplied = useRef(false)

  useEffect(() => {
    if (hook.isLoading) return
    if (targetFenApplied.current) return
    const targetFen = (location.state as { targetFen?: string } | null)?.targetFen
    if (!targetFen) return
    const move = hook.moves.find(m => m.toFen === targetFen && !m.isTransposition)
      ?? hook.moves.find(m => m.toFen === targetFen)
    if (move) {
      hook.navigateTo(move)
    }
    targetFenApplied.current = true
  }, [hook.isLoading, hook.moves, hook.navigateTo, location.state])

  // Load and refresh the due-card count for the Train button, and total count for Review All.
  const refreshCount = () => {
    if (!id) return
    void api.getDrillCount({ repertoireId: id }).then(setDrillCount)
    void api.getDrillCount({ repertoireId: id, ignoreSchedule: true }).then(setReviewAllCount)
  }
  useEffect(refreshCount, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load heatmap on mount/id-change and refresh when the window regains focus
  // (e.g. after returning from a drill session).
  useEffect(() => {
    if (id) loadHeatmap(id)
  }, [id, loadHeatmap])

  useEffect(() => {
    if (!id) return
    const handleFocus = () => loadHeatmap(id)
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [id, loadHeatmap])

  async function handleReset() {
    if (!id) return
    await api.resetDrillScope({ repertoireId: id })
    refreshCount()
    setResetConfirming(false)
  }

  // Feed the repertoire's current position to the shared engine.
  // engineFenOverride.set is stable (wrapped in useCallback), so it's safe in deps.
  const engineFenOverride = useEngineFenOverride()
  useEffect(() => {
    engineFenOverride.set(hook.currentFen)
    return () => engineFenOverride.set(null)
  }, [hook.currentFen, engineFenOverride.set])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const { activeIds, totalPanelCount, handleAdd, handleRemove, handleSetActiveTab } = useWorkspacePanels(layout, setLayout)
  const { activePanelLabel, handleDragStart, handleDragEnd } = useWorkspaceDnd(layout, setLayout)

  useTitlebarBreadcrumb(
    repertoire
      ? [{ label: repertoire.name, colourCircle: repertoire.colour }]
      : [],
  )
  const { compact } = useTitlebar()
  return (
    <RepertoireBuilderProvider value={hook}>
      <TitlebarToolbarLeftPortal>
        {resetConfirming ? (
          <>
            {!compact && (
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                Reset progress?
              </span>
            )}
            <button className={btnTitlebarDanger} onClick={() => void handleReset()}>Yes</button>
            <button className={btnTitlebarGhost} onClick={() => setResetConfirming(false)}>No</button>
          </>
        ) : (
          <>
            <button
              className={btnTitlebarPrimary}
              onClick={() => navigate('/openings/drill', {
                state: { scope: { repertoireId: id }, returnTo: `/openings/${id}` },
              })}
              aria-label="Start drill session for this repertoire"
              title={compact ? (drillCount !== null ? `Train (${drillCount})` : 'Train') : undefined}
            >
              <Play size={13} />
              {!compact && (drillCount !== null ? `Train (${drillCount})` : 'Train')}
            </button>
            <button
              className={btnTitlebarSecondary}
              onClick={() => navigate('/openings/drill', {
                state: { scope: { repertoireId: id, ignoreSchedule: true }, returnTo: `/openings/${id}` },
              })}
              aria-label="Review all moves in this repertoire"
              title={compact
                ? (reviewAllCount !== null ? `Review All (${reviewAllCount})` : 'Review All')
                : 'Review all moves regardless of schedule'}
            >
              {compact
                ? <Eye size={13} />
                : (reviewAllCount !== null ? `Review All (${reviewAllCount})` : 'Review All')}
            </button>
            <button
              className={btnTitlebarGhost}
              onClick={() => setResetConfirming(true)}
              aria-label="Reset drill progress for this repertoire"
              title={compact ? 'Reset drill progress' : undefined}
            >
              <RotateCcw size={13} />
              {!compact && 'Reset'}
            </button>
          </>
        )}
      </TitlebarToolbarLeftPortal>
      <TitlebarToolbarPortal>
        <PanelToggles
          panelIds={ALL_REPERTOIRE_PANEL_IDS}
          activeIds={activeIds}
          totalPanelCount={totalPanelCount}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </TitlebarToolbarPortal>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* ── Body ─────────────────────────────────────────────── */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                Loading…
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 p-2">
              <MosaicNode
                node={layout}
                onRemove={handleRemove}
                onSetActiveTab={handleSetActiveTab}
                isOnlyPanel={totalPanelCount === 1}
              />
            </div>
          )}
        </div>

        <DragOverlay>
          {activePanelLabel && (
            <div className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] shadow-lg bg-[var(--color-accent)] text-white opacity-90">
              {activePanelLabel}
            </div>
          )}
        </DragOverlay>
      </DndContext>

    </RepertoireBuilderProvider>
  )
}

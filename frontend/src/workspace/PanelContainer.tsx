import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core'
import { X } from 'lucide-react'
import { useState } from 'react'
import type { PanelId } from './types'
import { PANEL_DEFS } from './panelRegistry'
import { PanelHeaderActionsProvider } from './PanelHeaderContext'

interface PanelContainerProps {
  leafId: string
  panels: PanelId[]
  activeIdx: number
  onRemove: (panelId: PanelId) => void
  onSetActiveTab: (tabIdx: number) => void
  isOnlyPanel: boolean
  children: React.ReactNode
}

type Zone = 'top' | 'bottom' | 'left' | 'right' | 'center'

function DropIndicator({ zone }: { zone: Zone }) {
  const isH = zone === 'left' || zone === 'right'

  if (zone === 'center') {
    return (
      <div
        style={{ position: 'absolute', inset: 0 }}
        className="rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] opacity-10"
      />
    )
  }

  const lineStyle: React.CSSProperties = isH
    ? {
        position: 'absolute',
        top: 0, bottom: 0,
        width: 2,
        [zone === 'left' ? 'right' : 'left']: 0,
      }
    : {
        position: 'absolute',
        left: 0, right: 0,
        height: 2,
        [zone === 'top' ? 'bottom' : 'top']: 0,
      }

  return (
    <>
      <div
        style={{ position: 'absolute', inset: 0 }}
        className="bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] opacity-10 rounded-[var(--radius-md)]"
      />
      <div
        style={lineStyle}
        className="bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] opacity-80"
      />
    </>
  )
}


interface TabItemProps {
  leafId: string
  panelId: PanelId
  isActive: boolean
  isOnlyPanel: boolean
  onActivate: () => void
  onClose: () => void
}

function TabItem({ leafId, panelId, isActive, isOnlyPanel, onActivate, onClose }: TabItemProps) {
  const def = PANEL_DEFS[panelId]

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab:${leafId}:${panelId}`,
  })

  const beforeDrop = useDroppable({ id: `tab-slot:${leafId}:${panelId}:before` })
  const afterDrop  = useDroppable({ id: `tab-slot:${leafId}:${panelId}:after` })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      className={[
        'relative flex items-center gap-1.5 px-2.5 h-full shrink-0 select-none group/tab',
        'border-b-2 transition-colors cursor-grab active:cursor-grabbing',
        isActive
          ? 'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)]'
          : 'border-transparent hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      {/* Reorder drop: left half */}
      <div
        ref={beforeDrop.setNodeRef}
        style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '50%', pointerEvents: 'auto' }}
      >
        {beforeDrop.isOver && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2 }}
            className="bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)]" />
        )}
      </div>

      {/* Reorder drop: right half */}
      <div
        ref={afterDrop.setNodeRef}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '50%', pointerEvents: 'auto' }}
      >
        {afterDrop.isOver && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 2 }}
            className="bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)]" />
        )}
      </div>

      {/* Icon + label */}
      <def.icon
        size={11}
        strokeWidth={1.75}
        className={[
          'relative z-10 shrink-0 pointer-events-none',
          isActive
            ? 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]'
            : 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]',
        ].join(' ')}
        aria-hidden="true"
      />
      <span className={[
        'relative z-10 text-xs whitespace-nowrap pointer-events-none',
        isActive
          ? 'font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]'
          : 'font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]',
      ].join(' ')}>
        {def.label}
      </span>

      {/* Close button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onClose() }}
        disabled={isOnlyPanel}
        aria-label={`Close ${def.label}`}
        className={[
          'relative z-10 flex items-center justify-center w-3.5 h-3.5 rounded-[var(--radius-sm)] transition-colors ml-0.5',
          isOnlyPanel
            ? 'opacity-0 pointer-events-none'
            : 'opacity-0 group-hover/tab:opacity-100 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-3)] dark:hover:bg-[var(--color-dark-surface-3)] cursor-pointer',
        ].join(' ')}
      >
        <X size={9} strokeWidth={2} />
      </button>
    </div>
  )
}


export default function PanelContainer({
  leafId, panels, activeIdx, onRemove, onSetActiveTab, isOnlyPanel, children,
}: PanelContainerProps) {
  const { active } = useDndContext()
  const activeId = active ? String(active.id) : null
  // A tab being dragged from this very leaf: show edge zones but not center
  const isSameLeafTabDrag = activeId !== null && activeId.startsWith(`tab:${leafId}:`)
  // Any other foreign drag: show all zones
  const isExternalDrag = activeId !== null && activeId !== leafId && !isSameLeafTabDrag

  // Group drag — attached to the empty area of the tab bar (or the whole single-panel header)
  const { attributes: grpAttrs, listeners: grpListeners, setNodeRef: setGrpRef, isDragging: isGrpDragging } =
    useDraggable({ id: leafId })

  const top    = useDroppable({ id: `${leafId}:top`    })
  const bottom = useDroppable({ id: `${leafId}:bottom` })
  const left   = useDroppable({ id: `${leafId}:left`   })
  const right  = useDroppable({ id: `${leafId}:right`  })
  const center = useDroppable({ id: `${leafId}:center` })

  const zones: { zone: Zone; drop: ReturnType<typeof useDroppable>; style: React.CSSProperties }[] = [
    { zone: 'top',    drop: top,    style: { top: 0,    left: 0,    right: 0,    height: '25%' } },
    { zone: 'bottom', drop: bottom, style: { bottom: 0, left: 0,    right: 0,    height: '25%' } },
    { zone: 'left',   drop: left,   style: { top: '25%', left: 0,   bottom: '25%', width: '25%' } },
    { zone: 'right',  drop: right,  style: { top: '25%', right: 0,  bottom: '25%', width: '25%' } },
    { zone: 'center', drop: center, style: { top: '25%', left: '25%', right: '25%', bottom: '25%' } },
  ]

  const isMultiTab = panels.length > 1
  const activePanelId = panels[activeIdx]

  const [headerActionsSlot, setHeaderActionsSlot] = useState<HTMLElement | null>(null)

  return (
    <PanelHeaderActionsProvider value={headerActionsSlot}>
    <div
      data-testid={`panel-${activePanelId}`}
      style={{ position: 'relative' }}
      className={[
        'flex flex-col h-full w-full overflow-hidden',
        'rounded-[var(--radius-md)]',
        'border',
        'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
        'bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]',
        isGrpDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      {isMultiTab ? (
        /* ── Multi-tab header ── */
        <div className="flex items-stretch h-8 shrink-0 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]">
          {panels.map((panelId, idx) => (
            <TabItem
              key={panelId}
              leafId={leafId}
              panelId={panelId}
              isActive={idx === activeIdx}
              isOnlyPanel={isOnlyPanel}
              onActivate={() => onSetActiveTab(idx)}
              onClose={() => onRemove(panelId)}
            />
          ))}
          {/* Empty space — group drag handle */}
          <div
            ref={setGrpRef}
            {...grpAttrs}
            {...grpListeners}
            className="flex-1 cursor-grab active:cursor-grabbing"
            aria-label="Drag panel group"
          />
          {/* Actions slot — portaled content from active panel */}
          <div
            ref={setHeaderActionsSlot}
            onPointerDown={e => e.stopPropagation()}
            className="flex items-center px-1"
          />
        </div>
      ) : (
        /* ── Single-panel header — entire bar is the drag handle ── */
        <div
          ref={setGrpRef}
          {...grpAttrs}
          {...grpListeners}
          className="flex items-center gap-1 h-8 px-2 shrink-0 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] cursor-grab active:cursor-grabbing"
        >
          {(() => {
            const def = PANEL_DEFS[activePanelId]
            return (
              <>
                <def.icon
                  size={12}
                  strokeWidth={1.75}
                  className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] pointer-events-none"
                  aria-hidden="true"
                />
                <span className="flex-1 text-xs font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] select-none pointer-events-none">
                  {def.label}
                </span>
              </>
            )
          })()}

          {/* Actions slot — portaled content from active panel */}
          <div
            ref={setHeaderActionsSlot}
            onPointerDown={e => e.stopPropagation()}
            className="flex items-center"
          />

          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={() => onRemove(activePanelId)}
            disabled={isOnlyPanel}
            aria-label={`Close ${PANEL_DEFS[activePanelId].label}`}
            className={[
              'flex items-center justify-center w-4 h-4 rounded-[var(--radius-sm)] transition-colors',
              isOnlyPanel
                ? 'opacity-30 cursor-not-allowed text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]'
                : 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer',
            ].join(' ')}
          >
            <X size={10} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>

      {(isExternalDrag || isSameLeafTabDrag) && zones.map(({ zone, drop, style }) => {
        // Don't offer center-drop onto own leaf — it would be a no-op
        if (isSameLeafTabDrag && zone === 'center') return null
        return (
          <div
            key={zone}
            ref={drop.setNodeRef}
            style={{ position: 'absolute', ...style }}
            className="pointer-events-auto"
          >
            {drop.isOver && <DropIndicator zone={zone} />}
          </div>
        )
      })}
    </div>
    </PanelHeaderActionsProvider>
  )
}

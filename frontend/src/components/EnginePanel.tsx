import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, Columns2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { useEngineContext } from '@/context/EngineContext'
import { useEngineAnalysis, type EngineAnalysisHook } from '@/hooks/useEngineAnalysis'
import { pvToSan, formatPV, formatScore } from '@/lib/engineUtils'
import { EventsOn } from '@/lib/wailsRuntime'
import { api, type AnalysisQueueUpdate } from '@/lib/api'
import { btnCompact } from '@/lib/classNames'

function formatNodes(nodes: number): string {
  if (nodes >= 1000000) return `${(nodes / 1000000).toFixed(1)}M`
  if (nodes >= 1000) return `${Math.round(nodes / 1000)}k`
  return String(nodes)
}

function pvText(analysisFen: string, pvUci: string[]): string {
  const fields = analysisFen.split(' ')
  const color = fields[1] === 'b' ? 'b' : 'w'
  const moveNumber = parseInt(fields[5] ?? '1', 10) || 1
  return formatPV(pvToSan(analysisFen, pvUci), moveNumber, color)
}

function formatNps(nodes: number, timeMs: number): string {
  const kns = timeMs > 0 ? Math.round((nodes * 1000) / timeMs / 1000) : 0
  return `${kns} kn/s`
}

function formatStatusAB(line: { depth: number; nodes: number; timeMs: number }): string {
  return `depth ${line.depth} · ${formatNodes(line.nodes)} nodes · ${formatNps(line.nodes, line.timeMs)}`
}

function formatStatusMCTS(line: { depth: number; nodes: number; timeMs: number }): string {
  return `${formatNodes(line.nodes)} nodes · depth ${line.depth} · ${formatNps(line.nodes, line.timeMs)}`
}

const MAX_PV_PLY = 10
const LS_DUAL_MODE = 'masterboard-engine-dualMode'

interface EngineLinesSectionProps {
  ctx: EngineAnalysisHook
  expandedLines: Set<number>
  toggleExpand: (i: number) => void
}

function EngineLinesSection({ ctx, expandedLines, toggleExpand }: EngineLinesSectionProps) {
  const topLine = ctx.lines[0]

  return (
    <>
      {/* Score + depth/nodes header */}
      {topLine && (
        <div className="shrink-0 flex items-baseline gap-2 px-2 py-1 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <span
            data-testid="engine-score"
            className="text-14 font-semibold tabular-nums text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]"
          >
            {formatScore(topLine)}
          </span>
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            {ctx.engineType === 'mcts' ? (
              <><span data-testid="engine-nodes">{formatNodes(topLine.nodes)}</span>&nbsp;nodes</>
            ) : (
              <>depth&nbsp;<span data-testid="engine-depth">{topLine.depth}</span></>
            )}
          </span>
          <span
            data-testid="engine-status"
            className="ml-auto text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]"
          >
            {ctx.engineType === 'mcts' ? formatStatusMCTS(topLine) : formatStatusAB(topLine)}
          </span>
        </div>
      )}

      {/* PV lines */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {ctx.lines.length > 0 ? (
          <ul className="flex flex-col">
            {ctx.lines.map((line, i) => {
              const isExpanded = expandedLines.has(i)
              const hasMore = line.pvUci.length > MAX_PV_PLY
              const uciToShow = isExpanded ? line.pvUci : line.pvUci.slice(0, MAX_PV_PLY)
              return (
                <li
                  key={i}
                  data-testid={`engine-pv-${i}`}
                  className="flex items-baseline gap-1.5 px-2 py-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] font-mono"
                >
                  {ctx.lines.length > 1 && (
                    <span
                      data-testid={`engine-line-score-${i}`}
                      className="shrink-0 tabular-nums text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-semibold"
                    >
                      {formatScore(line)}
                    </span>
                  )}
                  <span
                    data-testid={`engine-pv-text-${i}`}
                    onClick={() => ctx.navigateToPV?.(ctx.analysisFen, line.pvUci)}
                    className="flex-1 min-w-0 cursor-pointer hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]"
                  >
                    {pvText(ctx.analysisFen, uciToShow)}
                  </span>
                  {hasMore && (
                    <button
                      data-testid={`engine-pv-expand-${i}`}
                      onClick={() => toggleExpand(i)}
                      aria-label={isExpanded ? 'Collapse PV line' : 'Expand PV line'}
                      className="shrink-0 ml-auto px-1 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
                    >
                      <ChevronRight size={12} className={isExpanded ? 'rotate-90 transition-transform' : 'rotate-180 transition-transform'} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="h-full flex items-center justify-center">
            <span className="text-14 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
              Press Start to start engine
            </span>
          </div>
        )}
      </div>
    </>
  )
}

interface SecondaryEngineHeaderProps {
  ctx2: EngineAnalysisHook
}

function SecondaryEngineHeader({ ctx2 }: SecondaryEngineHeaderProps) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
      {ctx2.availableEngines.length > 1 ? (
        <Select
          value={ctx2.activeEngine}
          onValueChange={ctx2.setActiveEngine}
          size="xs"
          className="flex-1 min-w-0"
          options={ctx2.availableEngines.map(e => ({ value: e.path, label: e.name }))}
        />
      ) : (
        <span className="flex-1 min-w-0 text-xs truncate text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
          {ctx2.engineName || 'Engine 2'}
        </span>
      )}
      <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
        {ctx2.isAnalysing ? 'analysing' : ctx2.isReady ? 'ready' : 'loading…'}
      </span>
    </div>
  )
}

export default function EnginePanel() {
  const ctx = useEngineContext()
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [expandedLines2, setExpandedLines2] = useState<Set<number>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  const [dualMode, setDualMode] = useState(() => {
    try { return localStorage.getItem(LS_DUAL_MODE) === 'true' } catch { return false }
  })

  // Always call hook unconditionally — React rules of hooks
  const ctx2 = useEngineAnalysis(ctx.fen, 'secondary')

  const { stopAnalysis } = ctx
  useEffect(() => () => stopAnalysis(), [stopAnalysis])

  // Disable Start while batch game analysis is in progress.
  useEffect(() => {
    api.getQueueStatus().then((s: AnalysisQueueUpdate) => {
      setBatchRunning(s.remaining > 0 || s.active > 0)
    }).catch(() => {})
    return EventsOn('analysis:queue-update', (s: AnalysisQueueUpdate) => {
      setBatchRunning(s.remaining > 0 || s.active > 0)
    })
  }, [])

  // Stop secondary engine on unmount if dual mode is active
  const { stopAnalysis: stopAnalysis2 } = ctx2
  useEffect(() => () => { if (dualMode) stopAnalysis2() }, [dualMode, stopAnalysis2])

  function toggleExpand(i: number) {
    setExpandedLines(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function toggleExpand2(i: number) {
    setExpandedLines2(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const toggleDualMode = useCallback(() => {
    setDualMode(prev => {
      const next = !prev
      try { localStorage.setItem(LS_DUAL_MODE, String(next)) } catch {}
      if (next) {
        if (ctx2.isReady) {
          // Engine already launched (dual mode was used before) — start only if primary is running.
          if (ctx.isAnalysing) ctx2.startAnalysis()
        } else {
          // First time enabling — pick a path and launch the secondary slot.
          // The effect below will start analysis once engine2:ready fires (if primary is running).
          const path = ctx.availableEngines.find(e => e.path !== ctx.activeEngine)?.path
                    ?? ctx.activeEngine
          if (path) ctx2.setActiveEngine(path)
        }
      } else {
        ctx2.stopAnalysis()
      }
      return next
    })
  }, [ctx, ctx2])

  // When the secondary engine finishes its handshake while dual mode is on,
  // start analysis automatically only if the primary engine is already running.
  useEffect(() => {
    if (dualMode && ctx2.isReady && !ctx2.isAnalysing && ctx.isAnalysing) {
      ctx2.startAnalysis()
    }
  }, [ctx2.isReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep secondary engine's multiPV in sync with the primary.
  useEffect(() => {
    if (dualMode) ctx2.setMultiPV(ctx.multiPV)
  }, [ctx.multiPV, dualMode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
        {ctx.isAnalysing ? (
          <button
            data-testid="engine-stop-btn"
            onClick={() => { ctx.stopAnalysis(); if (dualMode) ctx2.stopAnalysis() }}
            className={`${btnCompact} bg-[var(--color-accent)] text-white hover:opacity-90`}
          >
            Stop
          </button>
        ) : (
          <button
            data-testid="engine-start-btn"
            onClick={() => { ctx.startAnalysis(); if (dualMode && ctx2.isReady) ctx2.startAnalysis() }}
            disabled={!ctx.isReady || batchRunning}
            title={batchRunning ? 'Game analysis in progress — cancel it to use the engine' : undefined}
            className={`${btnCompact} bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] disabled:opacity-40 disabled:cursor-default hover:enabled:bg-[var(--color-surface-4)] dark:hover:enabled:bg-[var(--color-dark-surface-4)]`}
          >
            Start
          </button>
        )}

        {/* MultiPV selector */}
        <div className="flex items-center gap-0.5">
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mr-1">Lines</span>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              data-testid={`engine-multipv-btn-${n}`}
              onClick={() => ctx.setMultiPV(n)}
              className={[
                'w-6 h-5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer',
                ctx.multiPV === n
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-4)] dark:hover:bg-[var(--color-dark-surface-4)]',
              ].join(' ')}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Arrow toggle */}
        <button
          data-testid="engine-arrows-btn"
          onClick={ctx.toggleArrows}
          title={ctx.showArrows ? 'Hide best-move arrows' : 'Show best-move arrows'}
          aria-label="Toggle best-move arrows"
          aria-pressed={ctx.showArrows}
          className={[
            'w-6 h-5 flex items-center justify-center text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer',
            ctx.showArrows
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-4)] dark:hover:bg-[var(--color-dark-surface-4)]',
          ].join(' ')}
        >
          ↗
        </button>

        {/* Dual engine toggle */}
        <button
          data-testid="engine-dual-btn"
          onClick={toggleDualMode}
          title={dualMode ? 'Disable dual engine' : 'Enable dual engine'}
          aria-label="Toggle dual engine mode"
          aria-pressed={dualMode}
          className={[
            'w-6 h-5 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer',
            dualMode
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-4)] dark:hover:bg-[var(--color-dark-surface-4)]',
          ].join(' ')}
        >
          <Columns2 size={12} />
        </button>

        {/* Engine name */}
        {ctx.engineName && (
          <span
            data-testid="engine-name"
            className="ml-auto text-xs truncate max-w-[40%] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]"
            title={ctx.engineName}
          >
            {ctx.engineName}
          </span>
        )}
      </div>

      {/* Single or dual engine sections */}
      {dualMode ? (
        <div className="flex-1 min-h-0 flex flex-col divide-y divide-[var(--color-surface-3)] dark:divide-[var(--color-dark-surface-3)] overflow-hidden">
          <div data-testid="engine-section-1" className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <EngineLinesSection ctx={ctx} expandedLines={expandedLines} toggleExpand={toggleExpand} />
          </div>
          <div data-testid="engine-section-2" className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <SecondaryEngineHeader ctx2={ctx2} />
            <EngineLinesSection ctx={ctx2} expandedLines={expandedLines2} toggleExpand={toggleExpand2} />
          </div>
        </div>
      ) : (
        <>
          {/* Score + depth/nodes header */}
          {ctx.lines[0] && (
            <div className="shrink-0 flex items-baseline gap-2 px-2 py-1 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              <span
                data-testid="engine-score"
                className="text-14 font-semibold tabular-nums text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]"
              >
                {formatScore(ctx.lines[0])}
              </span>
              <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                {ctx.engineType === 'mcts' ? (
                  <><span data-testid="engine-nodes">{formatNodes(ctx.lines[0].nodes)}</span>&nbsp;nodes</>
                ) : (
                  <>depth&nbsp;<span data-testid="engine-depth">{ctx.lines[0].depth}</span></>
                )}
              </span>
              <span
                data-testid="engine-status"
                className="ml-auto text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]"
              >
                {ctx.engineType === 'mcts' ? formatStatusMCTS(ctx.lines[0]) : formatStatusAB(ctx.lines[0])}
              </span>
            </div>
          )}

          {/* PV lines */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {ctx.lines.length > 0 ? (
              <ul className="flex flex-col">
                {ctx.lines.map((line, i) => {
                  const isExpanded = expandedLines.has(i)
                  const hasMore = line.pvUci.length > MAX_PV_PLY
                  const uciToShow = isExpanded ? line.pvUci : line.pvUci.slice(0, MAX_PV_PLY)
                  return (
                    <li
                      key={i}
                      data-testid={`engine-pv-${i}`}
                      className="flex items-baseline gap-1.5 px-2 py-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] font-mono"
                    >
                      {ctx.lines.length > 1 && (
                        <span
                          data-testid={`engine-line-score-${i}`}
                          className="shrink-0 tabular-nums text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-semibold"
                        >
                          {formatScore(line)}
                        </span>
                      )}
                      <span
                        data-testid={`engine-pv-text-${i}`}
                        onClick={() => ctx.navigateToPV?.(ctx.analysisFen, line.pvUci)}
                        className="flex-1 min-w-0 cursor-pointer hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]"
                      >
                        {pvText(ctx.analysisFen, uciToShow)}
                      </span>
                      {hasMore && (
                        <button
                          data-testid={`engine-pv-expand-${i}`}
                          onClick={() => toggleExpand(i)}
                          aria-label={isExpanded ? 'Collapse PV line' : 'Expand PV line'}
                          className="shrink-0 ml-auto px-1 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
                        >
                          <ChevronRight size={12} className={isExpanded ? 'rotate-90 transition-transform' : 'rotate-180 transition-transform'} />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="h-full flex items-center justify-center">
                <span className="text-14 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                  Press Start to start engine
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

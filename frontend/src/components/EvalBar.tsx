const EVAL_BAR_W = 10  // px — width of the vertical eval bar

export { EVAL_BAR_W }

export const EVAL_BAR_GAP = 4 // px — gap between board and eval bar

export default function EvalBar({
  height,
  whitePct,
  score,
  orientation,
  visible,
}: {
  height: number
  whitePct: number
  score: string
  orientation: 'white' | 'black'
  visible: boolean
}) {
  const flexDir = orientation === 'white' ? 'flex-col-reverse' : 'flex-col'
  // Tooltip colours are chess-semantic (not theme-driven): white piece colour when
  // white is ahead, black piece colour when black is ahead.
  const tooltipBg   = whitePct >= 50 ? '#ffffff' : '#1a1a1a'
  const tooltipText = whitePct >= 50 ? '#1a1a1a' : '#ffffff'
  const tooltipBorder = whitePct >= 50 ? '#999999' : '#555555'

  return (
    <div
      data-testid="engine-eval-bar"
      role="progressbar"
      aria-label="Evaluation bar"
      aria-valuenow={Math.round(whitePct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: EVAL_BAR_W, height }}
      className={`relative group shrink-0 ${visible ? '' : 'invisible'}`}
    >
      <div
        data-testid="engine-eval-bar-inner"
        style={{ background: '#1a1a1a' }}
        className={`absolute inset-0 overflow-hidden flex ${flexDir}
          border border-[var(--color-content-tertiary)] dark:border-[var(--color-dark-content-tertiary)]`}
      >
        <div className="bg-white" style={{ height: `${whitePct}%` }} />
      </div>

      {visible && score && (
        <div
          data-testid="engine-eval-bar-tooltip"
          style={{ background: tooltipBg, color: tooltipText, borderColor: tooltipBorder }}
          className="absolute right-full top-1/2 -translate-y-1/2 mr-2
                     opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150
                     px-1.5 py-0.5 text-xs rounded-[var(--radius-sm)] whitespace-nowrap z-10 shadow-sm border"
        >
          {score}
        </div>
      )}
    </div>
  )
}

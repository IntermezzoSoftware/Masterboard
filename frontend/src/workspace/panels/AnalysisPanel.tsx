import { useRef, useEffect, useCallback, useState } from 'react'
import { BarChart2 } from 'lucide-react'
import { useAnalysisContext } from '@/context/AnalysisContext'
import { useChessGameContext } from '@/context/ChessGameContext'
import type { MoveEval, GameAnalysisResult } from '@/lib/api'
import { btnPrimary, btnLink } from '@/lib/classNames'
import { findPlyOfNode, findNodeByPly } from './boardPanelUtils'

export default function AnalysisPanel() {
  const { isAnalysing, progress, result, startAnalysis, cancelAnalysis } = useAnalysisContext()
  const { rootNode, goToNode, savedGameId } = useChessGameContext()

  // Compact layout: graph left, stats right — triggers when non-compact overflows
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const isCompactRef = useRef(false)
  const [isCompact, setIsCompact] = useState(false)
  useEffect(() => {
    if (!containerEl) return
    const ro = new ResizeObserver(() => {
      if (!isCompactRef.current) {
        if (containerEl.scrollHeight > containerEl.clientHeight) {
          isCompactRef.current = true
          setIsCompact(true)
        }
      } else {
        if (containerEl.clientHeight >= containerEl.clientWidth * 0.22 + 190) {
          isCompactRef.current = false
          setIsCompact(false)
        }
      }
    })
    ro.observe(containerEl)
    return () => ro.disconnect()
  }, [containerEl, isCompact])

  const hasMoves = rootNode.children.length > 0

  if (result?.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
        <span className="text-sm text-red-500 dark:text-red-400">Analysis failed</span>
        {result.errorMsg && (
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            {result.errorMsg}
          </span>
        )}
        {hasMoves && savedGameId && (
          <button onClick={startAnalysis} className={btnPrimary}>
            <BarChart2 size={12} strokeWidth={1.75} aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    )
  }

  if (isAnalysing) {
    const pct = progress ? Math.round((progress.ply / progress.totalPlies) * 100) : 0
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-3/4 h-2 rounded-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          {progress
            ? `Analysing move ${Math.ceil(progress.ply / 2)} of ${Math.ceil(progress.totalPlies / 2)} (${pct}%)`
            : 'Starting analysis...'}
        </span>
        <button onClick={cancelAnalysis} className={btnLink} title="Cancel analysis">
          Cancel
        </button>
      </div>
    )
  }

  if (!result || result.status !== 'complete') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
          <span className="text-14 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            {!hasMoves
              ? 'Analysis disabled on empty games.'
              : !savedGameId
                ? 'Save game to enable analysis.'
                : 'Analyse the full game with the engine.'}
          </span>
          {hasMoves && savedGameId && (
            <button onClick={startAnalysis} className={btnPrimary}>
              <BarChart2 size={12} strokeWidth={1.75} aria-hidden="true" />
              Analyse
            </button>
          )}
        </div>
      </div>
    )
  }

  const onClickPly = (ply: number) => {
    const node = findNodeByPly(rootNode, ply)
    if (node) goToNode(node)
  }

  const onClickClassification = (nag: number, color: 'white' | 'black') => {
    const ply = findFirstPlyWithNag(result.evals, nag, color)
    if (ply) {
      const node = findNodeByPly(rootNode, ply)
      if (node) goToNode(node)
    }
  }

  const reanalyseBtn = hasMoves && savedGameId && (
    <div className="flex-shrink-0 px-3 py-2 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] flex justify-center">
      <button onClick={startAnalysis} className={btnPrimary}>
        <BarChart2 size={12} strokeWidth={1.75} aria-hidden="true" />
        Re-analyse
      </button>
    </div>
  )

  if (isCompact) {
    return (
      <div ref={setContainerEl} className="flex flex-row h-full text-xs overflow-hidden" style={{ containerType: 'size' }}>
        <div className="flex-1 overflow-hidden">
          <div className="h-full" style={{ minWidth: 'min(200cqh, 100%)', maxWidth: '455cqh' }}>
            <EvalGraph result={result} rootNode={rootNode} onClickPly={onClickPly} />
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col overflow-hidden border-l border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]" style={{ width: 270 }}>
          <div className="flex-1 overflow-y-auto">
            <AnalysisSummary result={result} evals={result.evals} onClickClassification={onClickClassification} />
          </div>
          {reanalyseBtn}
        </div>
      </div>
    )
  }

  return (
    <div ref={setContainerEl} className="flex flex-col h-full text-xs overflow-y-auto" style={{ containerType: 'inline-size' }}>
      <div className="flex-1" style={{ minHeight: '22cqw', maxHeight: '50cqw' }}>
        <EvalGraph result={result} rootNode={rootNode} onClickPly={onClickPly} />
      </div>
      <div className="flex-shrink-0">
        <AnalysisSummary result={result} evals={result.evals} onClickClassification={onClickClassification} />
      </div>
      {reanalyseBtn}
    </div>
  )
}

function EvalGraph({ result, rootNode, onClickPly }: {
  result: GameAnalysisResult
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootNode: any
  onClickPly: (ply: number) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { currentNode } = useChessGameContext()
  const [hoveredPly, setHoveredPly] = useState<number | null>(null)
  // Track rendered pixel dimensions so dot radius can be capped in screen pixels
  const [svgSize, setSvgSize] = useState({ width: 1, height: 1 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) setSvgSize({ width: w, height: h })
    })
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  const evals = result.evals
  const totalPlies = evals.length
  if (totalPlies === 0) return null

  const width = 100
  const height = 40
  const maxCp = 1000 // clamp to +/-10 pawns

  const clamp = (cp: number) => Math.max(-maxCp, Math.min(maxCp, cp))

  const cpValues = evals.map(e => {
    if (e.playedMate != null) return e.playedMate > 0 ? maxCp : -maxCp
    return clamp(e.playedCp ?? 0)
  })

  const pointCoords = cpValues.map((cp, i) => ({
    x: (i / Math.max(totalPlies - 1, 1)) * width,
    y: height / 2 - (cp / maxCp) * (height / 2),
  }))
  const points = pointCoords.map(p => `${p.x},${p.y}`)

  const lineD = `M ${points.join(' L ')}`
  const areaD = `M 0,${height / 2} L ${points.join(' L ')} L ${width},${height / 2} Z`

  // Find current ply for the marker
  const currentPly = findPlyOfNode(rootNode, currentNode)
  const markerX = currentPly > 0 ? ((currentPly - 1) / Math.max(totalPlies - 1, 1)) * width : 0

  const xRatioToPly = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left) / rect.width
    const ply = Math.round(xRatio * (totalPlies - 1)) + 1
    return Math.max(1, Math.min(totalPlies, ply))
  }, [totalPlies])

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const ply = xRatioToPly(e)
    if (ply != null) onClickPly(ply)
  }, [xRatioToPly, onClickPly])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    setHoveredPly(xRatioToPly(e))
  }, [xRatioToPly])

  const handleMouseLeave = useCallback(() => setHoveredPly(null), [])

  const hoveredEval = hoveredPly != null ? evals[hoveredPly - 1] : null
  const hoveredLabel = hoveredEval
    ? (hoveredEval.playedMate != null
        ? `M${hoveredEval.playedMate > 0 ? '+' : ''}${hoveredEval.playedMate}`
        : ((hoveredEval.playedCp ?? 0) >= 0 ? '+' : '') + ((hoveredEval.playedCp ?? 0) / 100).toFixed(2))
    : null

  // Dot radius capped at DOT_MAX_PX screen pixels regardless of graph height.
  // ry in SVG units = desired_px * (svgHeight / renderedHeight); rx makes it circular on screen.
  const DOT_MAX_PX = 5
  const circleRy = Math.min(1.5, DOT_MAX_PX * height / svgSize.height)
  const circleRx = circleRy * (svgSize.height / svgSize.width) * (width / height)

  const hoveredPoint = hoveredPly != null ? pointCoords[hoveredPly - 1] : null

  return (
    <div className="h-full px-2 pt-2 pb-1 flex flex-col">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="flex-1 min-h-0 w-full block rounded-[var(--radius-sm)] cursor-pointer overflow-hidden"
        preserveAspectRatio="none"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          {/* Clip to upper half for white-advantage fill */}
          <clipPath id="eval-clip-white">
            <rect x="0" y="0" width={width} height={height / 2} />
          </clipPath>
          {/* Clip to lower half for black-advantage fill */}
          <clipPath id="eval-clip-black">
            <rect x="0" y={height / 2} width={width} height={height / 2} />
          </clipPath>
          {/* Mask: fades the background rect at top and bottom edges only.
              White = visible, black = hidden. Fills are drawn outside this mask
              so they remain fully solid regardless of evaluation. */}
          <mask id="eval-bg-mask">
            <linearGradient id="eval-bg-mask-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="black" />
              <stop offset="22%"  stopColor="white" />
              <stop offset="78%"  stopColor="white" />
              <stop offset="100%" stopColor="black" />
            </linearGradient>
            <rect x="0" y="0" width={width} height={height} fill="url(#eval-bg-mask-grad)" />
          </mask>
        </defs>
        {/* Background rect — masked so it fades at top/bottom; fills sit above unmasked */}
        <g mask="url(#eval-bg-mask)">
          <rect x="0" y="0" width={width} height={height}
            className="fill-[var(--color-surface-2)] dark:fill-[var(--color-dark-surface-2)]" />
        </g>
        {/* White advantage region — true white in light mode (matching), subdued in dark mode */}
        <path d={areaD} clipPath="url(#eval-clip-white)"
          className="fill-white dark:fill-[#909090]" />
        {/* Black advantage region — subdued in light mode, true black in dark mode (matching) */}
        <path d={areaD} clipPath="url(#eval-clip-black)"
          className="fill-[#505050] dark:fill-black" />
        {/* Reference lines at ±2.5, ±5, ±7.5 pawns */}
        {([
          { f: 0.125, label: '+7.5' },
          { f: 0.25,  label: '+5'   },
          { f: 0.375, label: '+2.5' },
          { f: 0.625, label: '-2.5' },
          { f: 0.75,  label: '-5'   },
          { f: 0.875, label: '-7.5' },
        ] as const).map(({ f, label }) => {
          // Convert screen px to SVG units, correcting for non-uniform x/y scale
          const svgPxH = (px: number) => px * height / svgSize.height
          const tx = 2 * width / svgSize.width
          const ty = height * f - svgPxH(2)
          const scaleX = (svgSize.height * width) / (svgSize.width * height)
          return (
            <g key={f}>
              <line x1="0" y1={height * f} x2={width} y2={height * f}
                stroke="currentColor" strokeWidth={1} strokeDasharray="3 2"
                opacity={0.2} vectorEffect="non-scaling-stroke" shapeRendering="crispEdges" />
              <g transform={`translate(${tx}, ${ty}) scale(${scaleX}, 1)`}>
                <text x={0} y={0} fontSize={svgPxH(8)} fill="currentColor"
                  opacity={0.35} dominantBaseline="auto">
                  {label}
                </text>
              </g>
            </g>
          )
        })}
        {/* Zero line */}
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
          stroke="currentColor" strokeWidth={1} opacity={0.35} vectorEffect="non-scaling-stroke" shapeRendering="crispEdges" />
        {/* Eval curve — accent colour follows the app appearance theme */}
        <path d={lineD} fill="none" strokeWidth={1} opacity={0.85}
          vectorEffect="non-scaling-stroke"
          className="stroke-[var(--color-accent-strong)] dark:stroke-[var(--color-dark-accent-strong)]" />
        {/* Hover dot */}
        {hoveredPoint && (
          <ellipse
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            rx={circleRx}
            ry={circleRy}
            fill="white"
            opacity={0.9}
          />
        )}
        {/* Current move marker — accent colour matches eval line */}
        {currentPly > 0 && (
          <line x1={markerX} y1="0" x2={markerX} y2={height}
            strokeWidth={1} opacity={0.8} vectorEffect="non-scaling-stroke"
            className="stroke-[var(--color-accent-strong)] dark:stroke-[var(--color-dark-accent-strong)]" />
        )}
      </svg>
      {/* Eval label beneath graph — fixed height so layout doesn't jump */}
      <div className="h-4 flex items-center justify-center">
        {hoveredLabel && (
          <span className="text-[10px] tabular-nums text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            {hoveredLabel}
          </span>
        )}
      </div>
    </div>
  )
}

function AnalysisSummary({ result, evals, onClickClassification }: {
  result: GameAnalysisResult
  evals: MoveEval[]
  onClickClassification: (nag: number, color: 'white' | 'black') => void
}) {
  const counts = { white: { 6: 0, 2: 0, 4: 0 }, black: { 6: 0, 2: 0, 4: 0 } }
  for (const ev of evals) {
    if (!ev.nag) continue
    const side = ev.ply % 2 === 1 ? 'white' : 'black'
    if (ev.nag in counts[side]) {
      counts[side][ev.nag as 2 | 4 | 6]++
    }
  }

  const clickableCell = 'text-center cursor-pointer hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] rounded-[var(--radius-sm)] px-1 py-0.5'

  return (
    <div className="px-3 py-2 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        <div />
        <div className="font-medium text-center">White</div>
        <div className="font-medium text-center">Black</div>

        <div className="font-medium">Accuracy</div>
        <div className="text-center font-semibold">
          {result.whiteAccuracy != null ? `${result.whiteAccuracy.toFixed(1)}%` : '-'}
        </div>
        <div className="text-center font-semibold">
          {result.blackAccuracy != null ? `${result.blackAccuracy.toFixed(1)}%` : '-'}
        </div>

        <div className="font-medium">ACPL</div>
        <div className="text-center">
          {result.whiteAcpl != null ? result.whiteAcpl.toFixed(1) : '-'}
        </div>
        <div className="text-center">
          {result.blackAcpl != null ? result.blackAcpl.toFixed(1) : '-'}
        </div>

        <div>Inaccuracy</div>
        <div className={clickableCell} onClick={() => onClickClassification(6, 'white')}>{counts.white[6]}</div>
        <div className={clickableCell} onClick={() => onClickClassification(6, 'black')}>{counts.black[6]}</div>

        <div>Mistake</div>
        <div className={clickableCell} onClick={() => onClickClassification(2, 'white')}>{counts.white[2]}</div>
        <div className={clickableCell} onClick={() => onClickClassification(2, 'black')}>{counts.black[2]}</div>

        <div>Blunder</div>
        <div className={clickableCell} onClick={() => onClickClassification(4, 'white')}>{counts.white[4]}</div>
        <div className={clickableCell} onClick={() => onClickClassification(4, 'black')}>{counts.black[4]}</div>
      </div>
    </div>
  )
}

function findFirstPlyWithNag(evals: MoveEval[], nag: number, color: 'white' | 'black'): number | null {
  for (const ev of evals) {
    if (ev.nag !== nag) continue
    const side = ev.ply % 2 === 1 ? 'white' : 'black'
    if (side === color) return ev.ply
  }
  return null
}

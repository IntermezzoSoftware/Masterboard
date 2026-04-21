import { useEffect, useMemo } from 'react'
import { useEngineContext } from '@/context/EngineContext'
import { useTheme, getAccentColor } from '@/context/ThemeContext'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'
import type { DrawShape, DrawBrushes } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import type { RefObject } from 'react'

/**
 * Manages engine arrow rendering for a chessground board via the imperative
 * setAutoShapes() API. This bypasses React's render cycle and chessground's
 * full set() → anim()/render() DOM walk, keeping arrow updates lightweight.
 *
 * Returns engineBrushes for inclusion in the board position config.
 * The caller is responsible for creating and passing cgApiRef.
 */
export function useBoardEngineArrows(
  cgApiRef: RefObject<Api | null>,
  boardConfig: Config,
  cgSize: number,
): { engineBrushes: DrawBrushes } {
  const { lines, isAnalysing: engineRunning, showArrows } = useEngineContext()
  const { theme, palette } = useTheme()

  const engineBrushes = useMemo((): DrawBrushes => {
    const accent = getAccentColor(palette, theme)
    return {
      // Required keys — preserve chessground defaults so user-drawn shapes still work.
      green:  { key: 'g',  color: '#15781B', opacity: 1,    lineWidth: 10 },
      red:    { key: 'r',  color: '#882020', opacity: 1,    lineWidth: 10 },
      blue:   { key: 'b',  color: '#003088', opacity: 1,    lineWidth: 10 },
      yellow: { key: 'y',  color: '#e68f00', opacity: 1,    lineWidth: 10 },
      // Engine arrow brushes — themed to the app accent colour.
      engineBest: { key: 'eb', color: accent, opacity: 1,   lineWidth: 14 },
      engineAlt:  { key: 'ea', color: accent, opacity: 0.55, lineWidth: 10 },
    }
  }, [theme, palette])

  const engineAutoShapes = useMemo((): DrawShape[] => {
    if (!showArrows || !engineRunning || lines.length === 0) return []
    return lines.slice(0, Math.min(lines.length, 3)).flatMap((line, i) => {
      const move = line.pvUci[0]
      if (!move || move.length < 4) return []
      const brush = i === 0 ? 'engineBest' : 'engineAlt'
      return [{ orig: move.slice(0, 2) as Key, dest: move.slice(2, 4) as Key, brush }]
    })
  }, [showArrows, engineRunning, lines])

  // Clear engine arrows immediately when the board position changes — the old
  // arrows are for a different position.
  useEffect(() => {
    cgApiRef.current?.setAutoShapes([])
  }, [boardConfig, cgApiRef])

  // Imperatively update engine arrows via the chessground API ref.
  // cgSize is included so the effect re-runs when the board first mounts
  // (cgApiRef transitions from null to a live API).
  useEffect(() => {
    cgApiRef.current?.setAutoShapes(engineAutoShapes)
  }, [engineAutoShapes, cgSize, cgApiRef])

  return { engineBrushes }
}

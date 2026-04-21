import { makeSanAndPlay } from 'chessops/san'
import { parseUci } from 'chessops/util'
import type { EngineInfo } from '@/lib/api'
import { chessFromFen } from '@/lib/fenUtils'

export function formatScore(line: EngineInfo): string {
  if (line.isMate) {
    return line.scoreMate > 0 ? `M${line.scoreMate}` : `-M${Math.abs(line.scoreMate)}`
  }
  const pawns = line.scoreCp / 100
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2)
}

export function evalWhitePercent(line: EngineInfo): number {
  if (line.isMate) return line.scoreMate > 0 ? 100 : 0
  return 50 + Math.max(-45, Math.min(45, line.scoreCp / 10))
}

export function pvToSan(fen: string, uciMoves: string[]): string[] {
  if (uciMoves.length === 0) return []
  let pos
  try { pos = chessFromFen(fen) } catch { return [] }
  const result: string[] = []
  for (const uci of uciMoves) {
    const move = parseUci(uci)
    if (!move || !pos.isLegal(move)) break
    result.push(makeSanAndPlay(pos, move))
  }
  return result
}

export function formatPV(pvSan: string[], startMoveNumber: number, color: 'w' | 'b'): string {
  if (pvSan.length === 0) return ''
  const parts: string[] = []
  let moveNum = startMoveNumber
  let isBlack = color === 'b'
  for (let i = 0; i < pvSan.length; i++) {
    const san = pvSan[i]
    if (isBlack) {
      parts.push(i === 0 ? `${moveNum}... ${san}` : san)
      moveNum++
      isBlack = false
    } else {
      parts.push(`${moveNum}. ${san}`)
      isBlack = true
    }
  }
  return parts.join(' ')
}

/**
 * PGN utilities for the repertoire builder.
 *
 * `parseAllMovesFromPGN` extracts every move from a PGN string, including all
 * variations (nested branches), and returns them as a flat array of position
 * pairs. NAGs and comments are preserved on each move.
 */

import type { Chess } from 'chessops/chess'
import { makeFen, INITIAL_FEN } from 'chessops/fen'
import { parseSan } from 'chessops/san'
import { makeUci } from 'chessops/util'
import { chessFromFen } from '@/lib/fenUtils'

export interface ExtractedMove {
  fromFen: string
  toFen: string
  san: string
  uci: string
  nag: number | null
  comment: string
}


/** Create an independent copy of a Chess position via FEN round-trip. */
function cloneChess(c: Chess): Chess {
  return chessFromFen(makeFen(c.toSetup()))
}


type Token =
  | { kind: 'move'; san: string }
  | { kind: 'open' }              // (
  | { kind: 'close' }             // )
  | { kind: 'nag'; n: number }    // $1
  | { kind: 'comment'; text: string } // { ... }
  | { kind: 'result' }            // 1-0, 0-1, 1/2-1/2, *

const RESULT_RE   = /^(1-0|0-1|1\/2-1\/2|\*)$/
const NAG_RE      = /^\$(\d+)$/
const MOVE_NUM_RE = /^\d+\.+$/

function tokenize(moveText: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < moveText.length) {
    // Skip whitespace
    if (/\s/.test(moveText[i])) { i++; continue }

    // Comment { ... }
    if (moveText[i] === '{') {
      let j = i + 1
      while (j < moveText.length && moveText[j] !== '}') j++
      const text = moveText.slice(i + 1, j).trim()
      tokens.push({ kind: 'comment', text })
      i = j + 1
      continue
    }

    if (moveText[i] === '(') { tokens.push({ kind: 'open' });  i++; continue }
    if (moveText[i] === ')') { tokens.push({ kind: 'close' }); i++; continue }

    // Read a word token (stops at whitespace, parens, and braces)
    let word = ''
    while (i < moveText.length && !/[\s(){}]/.test(moveText[i])) word += moveText[i++]

    if (!word) continue
    if (MOVE_NUM_RE.test(word)) continue
    if (RESULT_RE.test(word)) { tokens.push({ kind: 'result' }); continue }
    const nagMatch = word.match(NAG_RE)
    if (nagMatch) { tokens.push({ kind: 'nag', n: parseInt(nagMatch[1], 10) }); continue }

    // Strip leading move-number prefix (e.g. "1.e4" → "e4", "2...d5" → "d5").
    // Some PGN sources concatenate the move number with the SAN without a space.
    const stripped = word.replace(/^\d+\.+/, '')

    // Strip informal annotation suffixes (!?, !!, ?, !, etc.) and check/mate markers
    const san = stripped.replace(/[!?+#]+$/, '').trim()
    if (san) tokens.push({ kind: 'move', san })
  }

  return tokens
}


/**
 * Walk `tokens` starting at `pos.i`, applying moves to `chess` and recording
 * results. Returns when a `close` token is consumed or tokens are exhausted.
 *
 * NAGs and comments that follow a move are attached to it (PGN spec: annotation
 * tokens appear after the move they annotate). Only the first NAG is kept.
 */
function parseVariation(
  tokens: Token[],
  pos: { i: number },
  chess: Chess,
  result: ExtractedMove[],
): void {
  // preMoveChess holds the position before the most recently played move;
  // it is cloned into branches when a `(` is encountered.
  let preMoveChess = cloneChess(chess)

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i]

    if (tok.kind === 'close') {
      pos.i++
      return
    }

    if (tok.kind === 'open') {
      pos.i++
      const branch = cloneChess(preMoveChess)
      parseVariation(tokens, pos, branch, result)
      continue
    }

    if (tok.kind === 'result') {
      pos.i++
      return
    }

    // Consume standalone NAG or comment (before any move — e.g. game-level comment)
    if (tok.kind === 'nag' || tok.kind === 'comment') {
      pos.i++
      continue
    }

    // tok.kind === 'move'
    pos.i++

    preMoveChess = cloneChess(chess)

    const fromFen = makeFen(chess.toSetup())
    const move = parseSan(chess, tok.san)
    if (!move) continue  // illegal or unrecognized SAN — skip silently

    chess.play(move)
    const toFen = makeFen(chess.toSetup())
    const uci = makeUci(move)

    // Consume any trailing NAGs and comments that belong to this move
    let nag: number | null = null
    let comment = ''
    while (pos.i < tokens.length) {
      const next = tokens[pos.i]
      if (next.kind === 'nag') {
        if (nag === null) nag = next.n  // keep first NAG only
        pos.i++
      } else if (next.kind === 'comment') {
        comment = next.text
        pos.i++
      } else {
        break
      }
    }

    result.push({ fromFen, toFen, san: tok.san, uci, nag, comment })
  }
}


/**
 * Extract every move from a PGN string, including all variation branches.
 *
 * Returns a flat array of `{fromFen, toFen, san, uci, nag, comment}` tuples
 * across all lines. Duplicate positions (the same move reachable via different
 * PGN paths) may appear multiple times; callers should deduplicate by
 * `(fromFen, uci)`.
 *
 * Returns an empty array if the PGN is empty or cannot be parsed.
 */
export function parseAllMovesFromPGN(pgn: string): ExtractedMove[] {
  if (!pgn.trim()) return []

  // Strip PGN header tags [Key "Value"]
  const moveText = pgn.replace(/\[[^\]]*\]\s*/g, '')
  const tokens = tokenize(moveText)
  if (tokens.length === 0) return []

  const result: ExtractedMove[] = []
  try {
    const chess = chessFromFen(INITIAL_FEN)
    parseVariation(tokens, { i: 0 }, chess, result)
  } catch {
    return result
  }

  return result
}

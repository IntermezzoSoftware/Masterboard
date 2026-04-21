import { describe, it, expect } from 'vitest'
import { parseAllMovesFromPGN } from './pgnUtils'

// The Sicilian position FEN (after 1.e4 c5) — used to spot-check FEN correctness
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('parseAllMovesFromPGN', () => {
  it('returns empty array for empty PGN', () => {
    expect(parseAllMovesFromPGN('')).toEqual([])
    expect(parseAllMovesFromPGN('   ')).toEqual([])
  })

  it('extracts mainline moves with correct from/to FENs', () => {
    const moves = parseAllMovesFromPGN('1. e4 c5 *')
    expect(moves).toHaveLength(2)

    // First move: fromFen is the starting position
    expect(moves[0].san).toBe('e4')
    expect(moves[0].uci).toBe('e2e4')
    expect(moves[0].fromFen).toContain('PPPPPPPP/RNBQKBNR w KQkq')
    // Second move: fromFen is after 1.e4
    expect(moves[1].san).toBe('c5')
    expect(moves[1].uci).toBe('c7c5')
    // toFen should be the position after 1.e4 c5
    expect(moves[1].toFen).toContain('pp1ppppp')
  })

  it('handles PGN with headers', () => {
    const pgn = `[Event "Test"]
[White "A"]
[Black "B"]

1. d4 d5 2. c4 *`
    const moves = parseAllMovesFromPGN(pgn)
    expect(moves).toHaveLength(3)
    expect(moves.map(m => m.san)).toEqual(['d4', 'd5', 'c4'])
  })

  it('extracts both mainline and variation moves', () => {
    // 1.e4 with variation 1.d4
    const pgn = '1. e4 (1. d4 d5) e5 *'
    const moves = parseAllMovesFromPGN(pgn)

    const sans = moves.map(m => m.san)
    expect(sans).toContain('e4')
    expect(sans).toContain('d4')
    expect(sans).toContain('d5')
    expect(sans).toContain('e5')
    // All four moves should be present (order: mainline interleaved with variation)
    expect(moves).toHaveLength(4)
  })

  it('extracts nested variations', () => {
    // 1.e4 e5, with variation on move 1 (1.d4) and nested variation inside it (1.d4 Nf6)
    const pgn = '1. e4 (1. d4 d5 (1. d4 Nf6)) e5 *'
    const moves = parseAllMovesFromPGN(pgn)

    const sans = moves.map(m => m.san)
    expect(sans).toContain('e4')
    expect(sans).toContain('d4')
    expect(sans).toContain('d5')
    expect(sans).toContain('Nf6')
    expect(sans).toContain('e5')
  })

  it('all moves start from the initial FEN', () => {
    // All first moves should have fromFen === INITIAL_FEN
    const pgn = '1. e4 (1. d4) (1. Nf3) e5 *'
    const moves = parseAllMovesFromPGN(pgn)
    const firstMoves = moves.filter(m => m.fromFen.startsWith('rnbqkbnr/pppppppp'))
    expect(firstMoves.length).toBeGreaterThanOrEqual(3) // e4, d4, Nf3
  })

  it('variation branches restore to parent position', () => {
    // After (1. d4), mainline 1...e5 should still be a response to 1.e4
    const pgn = '1. e4 (1. d4 d5) e5 *'
    const moves = parseAllMovesFromPGN(pgn)

    // 1.e4 toFen should be the fromFen for 1...e5
    const e4 = moves.find(m => m.san === 'e4')!
    const e5 = moves.find(m => m.san === 'e5')!
    expect(e5.fromFen).toBe(e4.toFen)
  })

  it('preserves NAGs and comments on moves', () => {
    const pgn = '1. e4 { Good opening move } $1 c5 $6 { Sicilian } *'
    const moves = parseAllMovesFromPGN(pgn)
    expect(moves).toHaveLength(2)
    expect(moves[0].san).toBe('e4')
    expect(moves[0].nag).toBe(1)
    expect(moves[0].comment).toBe('Good opening move')
    expect(moves[1].san).toBe('c5')
    expect(moves[1].nag).toBe(6)
    expect(moves[1].comment).toBe('Sicilian')
  })

  it('handles PGN with annotation suffixes on SAN', () => {
    const pgn = '1. e4! { Good move } c5? $2 *'
    const moves = parseAllMovesFromPGN(pgn)
    // ! and ? suffixes stripped from SAN; annotations preserved
    expect(moves).toHaveLength(2)
    expect(moves[0].san).toBe('e4')
    expect(moves[0].comment).toBe('Good move')
    expect(moves[1].san).toBe('c5')
    expect(moves[1].nag).toBe(2)
  })

  it('returns empty for a result-only PGN', () => {
    expect(parseAllMovesFromPGN('*')).toEqual([])
    expect(parseAllMovesFromPGN('1-0')).toEqual([])
  })

  it('handles compact move-number format (no space between number and SAN)', () => {
    // Some PGN sources write "1.e4" instead of "1. e4"
    const pgn = '1.e4 c6 2.d4 d5 3.exd5 cxd5 *'
    const moves = parseAllMovesFromPGN(pgn)
    expect(moves.map(m => m.san)).toEqual(['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'])
  })

  it('handles compact format with variations', () => {
    const pgn = '1.e4 c6 2.d4 ( 2.d3 d5 ) ( 2.Nf3 d5 ) 2...d5 *'
    const moves = parseAllMovesFromPGN(pgn)
    const sans = moves.map(m => m.san)
    expect(sans).toContain('e4')
    expect(sans).toContain('c6')
    expect(sans).toContain('d4')
    expect(sans).toContain('d3')
    expect(sans).toContain('Nf3')
    // d5 appears multiple times (mainline + each variation)
    expect(moves.filter(m => m.san === 'd5')).toHaveLength(3)
  })
})

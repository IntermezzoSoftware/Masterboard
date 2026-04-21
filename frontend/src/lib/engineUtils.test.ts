import { describe, it, expect } from 'vitest'
import { INITIAL_FEN } from 'chessops/fen'
import { pvToSan, formatPV, formatScore, evalWhitePercent } from './engineUtils'
import type { EngineInfo } from '@/lib/api'

function makeInfo(overrides: Partial<EngineInfo> = {}): EngineInfo {
  return {
    depth: 1, selDepth: 1, multiPV: 1, scoreCp: 0,
    isMate: false, scoreMate: 0, nodes: 1000, timeMs: 100, pvUci: [],
    ...overrides,
  }
}

describe('pvToSan', () => {
  it('1: two opening moves → SAN', () => {
    expect(pvToSan(INITIAL_FEN, ['e2e4', 'e7e5'])).toEqual(['e4', 'e5'])
  })

  it('2: Ruy Lopez opening — piece moves including bishop', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 (Ruy Lopez)
    expect(pvToSan(INITIAL_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  })

  it('3: empty input → empty output', () => {
    expect(pvToSan(INITIAL_FEN, [])).toEqual([])
  })

  it('4: stops at first illegal move', () => {
    expect(pvToSan(INITIAL_FEN, ['e2e4', 'INVALID'])).toEqual(['e4'])
  })
})

describe('formatPV', () => {
  it('5: white to move, moves 1+', () => {
    expect(formatPV(['e4', 'e5', 'Nf3'], 1, 'w')).toBe('1. e4 e5 2. Nf3')
  })

  it('6: black to move mid-game', () => {
    expect(formatPV(['Nf6', 'Nc3'], 2, 'b')).toBe('2... Nf6 3. Nc3')
  })
})

describe('formatScore', () => {
  it('7: positive centipawns → "+X.XX"', () => {
    expect(formatScore(makeInfo({ scoreCp: 50 }))).toBe('+0.50')
  })

  it('8: negative centipawns → "-X.XX"', () => {
    expect(formatScore(makeInfo({ scoreCp: -130 }))).toBe('-1.30')
  })

  it('9: mate in N → "MN"', () => {
    expect(formatScore(makeInfo({ isMate: true, scoreMate: 3 }))).toBe('M3')
  })

  it('10: mated in N → "-MN"', () => {
    expect(formatScore(makeInfo({ isMate: true, scoreMate: -2 }))).toBe('-M2')
  })
})

describe('evalWhitePercent', () => {
  it('11: scoreCp:0 → 50', () => {
    expect(evalWhitePercent(makeInfo({ scoreCp: 0 }))).toBe(50)
  })

  it('12: scoreCp:500 → 95 (clamped at +45)', () => {
    expect(evalWhitePercent(makeInfo({ scoreCp: 500 }))).toBe(95)
  })

  it('13: scoreCp:-500 → 5 (clamped)', () => {
    expect(evalWhitePercent(makeInfo({ scoreCp: -500 }))).toBe(5)
  })

  it('14: mate for white → 100', () => {
    expect(evalWhitePercent(makeInfo({ isMate: true, scoreMate: 2 }))).toBe(100)
  })

  it('15: mate for black → 0', () => {
    expect(evalWhitePercent(makeInfo({ isMate: true, scoreMate: -2 }))).toBe(0)
  })
})

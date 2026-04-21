import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/components/EvalBar', () => ({
  EVAL_BAR_W: 10,
  EVAL_BAR_GAP: 4,
  default: () => null,
}))

// Import after mock so the constants are stubbed
import { computeSize, computeCgSize, findPlyOfNode, CONTROLS_H, BOARD_GAP } from './boardPanelUtils'

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true })
})

describe('computeSize', () => {
  // CONTROLS_H=48, BOARD_GAP=8, EVAL_BAR_W=10, EVAL_BAR_GAP=4
  // formula: max(floor(min(h - 48 - 8, w - 10 - 4)), 100)

  it('returns height-constrained size when height is limiting', () => {
    // h-56=344, w-14=786 → min=344
    const size = computeSize(800, 400)
    expect(size).toBe(344)
  })

  it('returns width-constrained size when width is limiting', () => {
    // h-56=544, w-14=186 → min=186
    const size = computeSize(200, 600)
    expect(size).toBe(186)
  })

  it('clamps to minimum of 100', () => {
    // very small container — result would be negative without clamp
    const size = computeSize(50, 50)
    expect(size).toBe(100)
  })

  it('uses CONTROLS_H and BOARD_GAP constants', () => {
    expect(CONTROLS_H).toBe(48)
    expect(BOARD_GAP).toBe(8)
  })
})

describe('computeCgSize', () => {
  it('returns pixel-aligned size at 1x DPR', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true })
    // 344 * 1 = 344; floor(344/8)*8 = 344; 344/1 = 344
    expect(computeCgSize(344)).toBe(344)
  })

  it('aligns to 8-pixel grid at 2x DPR', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, writable: true, configurable: true })
    // 300 * 2 = 600; floor(600/8)*8 = 600; 600/2 = 300 — divisible by 8
    expect(computeCgSize(300)).toBe(300)
  })

  it('rounds down to multiple of 8 at 2x DPR for non-aligned input', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, writable: true, configurable: true })
    // 101 * 2 = 202; floor(202/8)*8 = 200; 200/2 = 100
    expect(computeCgSize(101)).toBe(100)
  })

  it('result is always a multiple of (8/DPR)', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, writable: true, configurable: true })
    const result = computeCgSize(345)
    // At 2x DPR, result * 2 must be divisible by 8
    expect((result * 2) % 8).toBe(0)
  })
})

describe('findPlyOfNode', () => {
  it('returns 0 when root is the current node', () => {
    const root = { id: 'a', children: [] }
    expect(findPlyOfNode(root, root)).toBe(0)
  })

  it('returns correct ply for direct child', () => {
    const child = { id: 'b', children: [] }
    const root = { id: 'a', children: [child] }
    expect(findPlyOfNode(root, child)).toBe(1)
  })

  it('returns correct ply for grandchild', () => {
    const gc = { id: 'c', children: [] }
    const child = { id: 'b', children: [gc] }
    const root = { id: 'a', children: [child] }
    expect(findPlyOfNode(root, gc)).toBe(2)
  })

  it('returns 0 when node is not found in the main line', () => {
    const other = { id: 'z', children: [] }
    const root = { id: 'a', children: [{ id: 'b', children: [] }] }
    expect(findPlyOfNode(root, other)).toBe(0)
  })

  it('matches by id when object reference differs', () => {
    const root = { id: 'a', children: [{ id: 'b', children: [] }] }
    const lookup = { id: 'b' }
    expect(findPlyOfNode(root, lookup)).toBe(1)
  })
})

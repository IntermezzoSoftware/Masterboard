export { EVAL_BAR_GAP } from '@/components/EvalBar'
import { EVAL_BAR_W, EVAL_BAR_GAP } from '@/components/EvalBar'

export const CONTROLS_H = 48  // h-12
export const BOARD_GAP  = 8   // gap-2 between board and controls

export const inputFilter = {
  ignoreEventWhen: (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement,
}

// Maximum available square size given container dimensions.
export function computeSize(w: number, h: number): number {
  return Math.max(Math.floor(Math.min(h - CONTROLS_H - BOARD_GAP, w - EVAL_BAR_W - EVAL_BAR_GAP)), 100)
}

// Replicates chessground's updateBounds() formula from render.js:
//   width = floor(boardSize * devicePixelRatio / 8) * 8 / devicePixelRatio
// This is the exact height that chessground will assign to <cg-container>.
export function computeCgSize(boardSize: number): number {
  const dpr = window.devicePixelRatio ?? 1
  return (Math.floor((boardSize * dpr) / 8) * 8) / dpr
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findNodeByPly(rootNode: any, targetPly: number): any {
  let node = rootNode
  for (let i = 0; i < targetPly; i++) {
    if (!node?.children?.[0]) return null
    node = node.children[0]
  }
  return node
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findPlyOfNode(rootNode: any, currentNode: any): number {
  let node = rootNode
  let ply = 0
  while (node) {
    if (node === currentNode || node.id === currentNode.id) return ply
    if (!node.children?.[0]) return 0
    node = node.children[0]
    ply++
  }
  return 0
}

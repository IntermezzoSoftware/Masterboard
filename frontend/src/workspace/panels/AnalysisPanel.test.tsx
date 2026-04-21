import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const rootNode = { id: '0', fen: INITIAL_FEN, move: null, san: null, parent: null, children: [] }

const mockStartAnalysis = vi.hoisted(() => vi.fn())
const mockCancelAnalysis = vi.hoisted(() => vi.fn())

const mockAnalysisValue = vi.hoisted(() => ({
  isAnalysing: false,
  progress: null as { ply: number; totalPlies: number } | null,
  result: null as any,
  startAnalysis: mockStartAnalysis,
  cancelAnalysis: mockCancelAnalysis,
}))

const mockChessGameValue = {
  rootNode,
  currentNode: rootNode,
  goToNode: vi.fn(),
  savedGameId: null as string | null,
}

vi.mock('@/context/AnalysisContext', () => ({
  useAnalysisContext: () => mockAnalysisValue,
}))

vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: () => mockChessGameValue,
}))

import AnalysisPanel from './AnalysisPanel'

describe('AnalysisPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalysisValue.isAnalysing = false
    mockAnalysisValue.progress = null
    mockAnalysisValue.result = null
    mockChessGameValue.rootNode = rootNode
    mockChessGameValue.savedGameId = null
  })

  it('shows empty state prompting to play moves when no moves', () => {
    render(<AnalysisPanel />)
    expect(screen.getByText(/analysis disabled on empty games/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /analyse/i })).not.toBeInTheDocument()
  })

  it('shows save prompt when game has moves but is not saved', () => {
    mockChessGameValue.rootNode = { ...rootNode, children: [{ id: '1' }] } as any
    render(<AnalysisPanel />)
    expect(screen.getByText(/save game to enable analysis/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /analyse/i })).not.toBeInTheDocument()
  })

  it('shows Analyse button when game is saved with moves', () => {
    mockChessGameValue.rootNode = { ...rootNode, children: [{ id: '1' }] } as any
    mockChessGameValue.savedGameId = 'game-1'
    render(<AnalysisPanel />)
    const btn = screen.getByRole('button', { name: /analyse/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(mockStartAnalysis).toHaveBeenCalled()
  })

  it('shows error state when analysis failed', () => {
    mockAnalysisValue.result = {
      status: 'error',
      errorMsg: 'engine crashed',
      evals: [],
    }
    render(<AnalysisPanel />)
    expect(screen.getByText('Analysis failed')).toBeInTheDocument()
    expect(screen.getByText('engine crashed')).toBeInTheDocument()
  })

  it('shows Retry button on error when game is saved with moves', () => {
    mockChessGameValue.rootNode = { ...rootNode, children: [{ id: '1' }] } as any
    mockChessGameValue.savedGameId = 'game-1'
    mockAnalysisValue.result = {
      status: 'error',
      errorMsg: 'engine crashed',
      evals: [],
    }
    render(<AnalysisPanel />)
    const btn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(btn)
    expect(mockStartAnalysis).toHaveBeenCalled()
  })

  it('shows progress bar during analysis', () => {
    mockAnalysisValue.isAnalysing = true
    mockAnalysisValue.progress = { ply: 10, totalPlies: 40 }
    render(<AnalysisPanel />)
    expect(screen.getByText(/analysing move 5 of 20/i)).toBeInTheDocument()
    expect(screen.getByText(/25%/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows Cancel button during analysis', () => {
    mockAnalysisValue.isAnalysing = true
    render(<AnalysisPanel />)
    const btn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(btn)
    expect(mockCancelAnalysis).toHaveBeenCalled()
  })

  it('shows "Starting analysis..." when no progress yet', () => {
    mockAnalysisValue.isAnalysing = true
    render(<AnalysisPanel />)
    expect(screen.getByText(/starting analysis/i)).toBeInTheDocument()
  })

  it('shows complete analysis results with Re-analyse button', () => {
    mockChessGameValue.rootNode = { ...rootNode, children: [{ id: '1' }] } as any
    mockChessGameValue.savedGameId = 'game-1'
    mockAnalysisValue.result = {
      status: 'complete',
      whiteAccuracy: 85.3,
      blackAccuracy: 91.2,
      whiteAcpl: 22.3,
      blackAcpl: 15.1,
      evals: [
        { ply: 1, playedCp: 30, bestCp: 30, bestPv: 'e2e4', accuracy: 100, nag: null },
        { ply: 2, playedCp: -20, bestCp: -30, bestPv: 'e7e5', accuracy: 90, nag: null },
      ],
    }
    render(<AnalysisPanel />)
    expect(screen.getByText('85.3%')).toBeInTheDocument()
    expect(screen.getByText('91.2%')).toBeInTheDocument()
    expect(screen.getByText('22.3')).toBeInTheDocument()
    expect(screen.getByText('15.1')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /re-analyse/i })
    fireEvent.click(btn)
    expect(mockStartAnalysis).toHaveBeenCalled()
  })
})

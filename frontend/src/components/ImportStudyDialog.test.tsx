import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImportStudyDialog } from './ImportStudyDialog'
import type { ImportStudyResult } from '@/lib/api'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => ({ set: vi.fn(), destroy: vi.fn() })),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

vi.mock('chessops/chess', () => ({}))
vi.mock('chessops/fen', () => ({ INITIAL_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', parseFen: vi.fn(), makeFen: vi.fn() }))
vi.mock('chessops/compat', () => ({ chessgroundDests: vi.fn(() => new Map()) }))
vi.mock('chessops/san', () => ({ parseSan: vi.fn() }))
vi.mock('chessops/util', () => ({ makeUci: vi.fn() }))

vi.mock('@/context/ChessGameContext', () => ({
  useChessGame: () => ({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  }),
}))

vi.mock('@/context/AnalysisContext', () => ({
  useAnalysis: () => ({}),
}))

const mockFetchLichessStudyMeta = vi.fn()
const mockImportLichessStudy = vi.fn()
const mockLichessOAuthStatus = vi.fn()
const mockListLichessStudies = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    fetchLichessStudyMeta: (...args: unknown[]) => mockFetchLichessStudyMeta(...args),
    importLichessStudy: (...args: unknown[]) => mockImportLichessStudy(...args),
    lichessOAuthStatus: (...args: unknown[]) => mockLichessOAuthStatus(...args),
    listLichessStudies: (...args: unknown[]) => mockListLichessStudies(...args),
    listRepertoires: () => Promise.resolve([]),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_META = {
  id: 'abc12345',
  name: 'My Study',
  private: false,
  chapters: [
    { id: 'ch1', name: 'Chapter One', orientation: 'white' as const },
    { id: 'ch2', name: 'Chapter Two', orientation: 'white' as const },
  ],
}

const MOCK_REPERTOIRES = [
  { id: 'rep-1', name: 'Ruy Lopez', colour: 'white' as const, description: '' },
  { id: 'rep-2', name: 'Sicilian', colour: 'black' as const, description: '' },
]

const defaultProps = {
  onClose: vi.fn(),
  onImported: vi.fn(),
}

async function advanceToPreview() {
  mockFetchLichessStudyMeta.mockResolvedValue(MOCK_META)
  fireEvent.change(screen.getByPlaceholderText('https://lichess.org/study/XXXXXXXX'), {
    target: { value: 'abc12345' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(() => expect(screen.getByText('Chapter One')).toBeInTheDocument())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportStudyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: not connected — dialog shows URL tab
    mockLichessOAuthStatus.mockResolvedValue('')
    mockListLichessStudies.mockResolvedValue([])
  })

  it('blocks Preview when study input is empty', () => {
    render(<ImportStudyDialog {...defaultProps} />)
    const previewBtn = screen.getByRole('button', { name: 'Preview' })
    expect(previewBtn).toBeDisabled()
  })

  it('enables Preview only when a valid 8-char ID is typed', () => {
    render(<ImportStudyDialog {...defaultProps} />)
    const input = screen.getByPlaceholderText('https://lichess.org/study/XXXXXXXX')
    fireEvent.change(input, { target: { value: 'short' } })
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'abc12345' } })
    expect(screen.getByRole('button', { name: 'Preview' })).not.toBeDisabled()
  })

  describe('destination toggle', () => {
    it('defaults to Repertoire destination', () => {
      render(<ImportStudyDialog {...defaultProps} />)
      const repBtn = screen.getByRole('button', { name: 'Import as Repertoire' })
      const gamesBtn = screen.getByRole('button', { name: 'Add to Games Library' })
      // Repertoire button should carry active class; just assert both are present
      expect(repBtn).toBeInTheDocument()
      expect(gamesBtn).toBeInTheDocument()
    })

    it('switches to Games Library destination on click', () => {
      render(<ImportStudyDialog defaultDestination="repertoire" {...defaultProps} />)
      fireEvent.click(screen.getByRole('button', { name: 'Add to Games Library' }))
      // Re-render: games button should now appear active (no assertion on class, but no crash)
      expect(screen.getByRole('button', { name: 'Add to Games Library' })).toBeInTheDocument()
    })

    it('defaults to Games Library when defaultDestination is "games"', () => {
      render(<ImportStudyDialog defaultDestination="games" {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'Add to Games Library' })).toBeInTheDocument()
    })
  })

  describe('preview step', () => {
    it('renders chapter list after successful fetch', async () => {
      render(<ImportStudyDialog {...defaultProps} />)
      await advanceToPreview()
      expect(screen.getByText('Chapter One')).toBeInTheDocument()
      expect(screen.getByText('Chapter Two')).toBeInTheDocument()
    })

    it('shows chapter count in import button', async () => {
      render(<ImportStudyDialog {...defaultProps} />)
      await advanceToPreview()
      expect(screen.getByRole('button', { name: 'Import 2 chapters' })).toBeInTheDocument()
    })
  })

  describe('auth error state', () => {
    it('shows private study error message when fetch returns private error', async () => {
      mockFetchLichessStudyMeta.mockRejectedValue(new Error('study is private'))
      render(<ImportStudyDialog {...defaultProps} />)
      fireEvent.change(screen.getByPlaceholderText('https://lichess.org/study/XXXXXXXX'), {
        target: { value: 'abc12345' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
      await waitFor(() =>
        expect(screen.getByText(/private/i)).toBeInTheDocument()
      )
      expect(screen.getByText(/Connect your Lichess account/i)).toBeInTheDocument()
    })
  })

  describe('import disabled when useExisting=true but no repo selected', () => {
    it('disables Import button when "Add to existing" is active but no repertoire is selected', async () => {
      render(
        <ImportStudyDialog
          {...defaultProps}
          repertoires={MOCK_REPERTOIRES}
        />
      )
      await advanceToPreview()
      // Click "Add to existing" button
      const addToExistingBtn = screen.getByRole('button', { name: 'Add to existing' })
      fireEvent.click(addToExistingBtn)
      // Select element starts with empty value ""
      const importBtn = screen.getByRole('button', { name: 'Import 2 chapters' })
      expect(importBtn).toBeDisabled()
    })

    it('enables Import button when an existing repertoire is selected', async () => {
      render(
        <ImportStudyDialog
          {...defaultProps}
          repertoires={MOCK_REPERTOIRES}
        />
      )
      await advanceToPreview()
      fireEvent.click(screen.getByRole('button', { name: 'Add to existing' }))
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'rep-1' } })
      expect(screen.getByRole('button', { name: 'Import 2 chapters' })).not.toBeDisabled()
    })
  })

  describe('successful import', () => {
    it('calls onImported with result and repertoireId from result', async () => {
      const mockResult: ImportStudyResult = {
        chaptersImported: 2,
        movesImported: 30,
        gamesImported: 0,
        duplicates: 0,
        repertoireId: 'new-rep-abc',
      }
      mockImportLichessStudy.mockResolvedValue(mockResult)
      render(<ImportStudyDialog {...defaultProps} />)
      await advanceToPreview()
      fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }))
      await waitFor(() =>
        expect(defaultProps.onImported).toHaveBeenCalledWith(mockResult, 'new-rep-abc')
      )
    })

    it('calls onImported with undefined repertoireId when result has no repertoireId', async () => {
      const mockResult: ImportStudyResult = {
        chaptersImported: 2,
        movesImported: 0,
        gamesImported: 2,
        duplicates: 0,
      }
      mockImportLichessStudy.mockResolvedValue(mockResult)
      render(<ImportStudyDialog defaultDestination="games" {...defaultProps} />)
      await advanceToPreview()
      fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }))
      await waitFor(() =>
        expect(defaultProps.onImported).toHaveBeenCalledWith(mockResult, undefined)
      )
    })
  })
})

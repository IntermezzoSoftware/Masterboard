import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from './ThemeContext'

vi.mock('@/assets/pieces/merida.css?raw',     () => ({ default: 'html .cg-wrap piece.knight.white { background-image: url("merida-mock"); }' }))
vi.mock('@/assets/pieces/alpha.css?raw',      () => ({ default: 'html .cg-wrap piece.knight.white { background-image: url("alpha-mock"); }' }))
vi.mock('@/assets/pieces/california.css?raw', () => ({ default: 'html .cg-wrap piece.knight.white { background-image: url("california-mock"); }' }))
vi.mock('@/assets/pieces/staunty.css?raw',    () => ({ default: 'html .cg-wrap piece.knight.white { background-image: url("staunty-mock"); }' }))

function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

function PieceSetConsumer() {
  const { pieceSet, setPieceSet } = useTheme()
  return (
    <div>
      <span data-testid="piece-set">{pieceSet}</span>
      <button onClick={() => setPieceSet('merida')}>set merida</button>
      <button onClick={() => setPieceSet('cburnett')}>set cburnett</button>
    </div>
  )
}

function BoardThemeConsumer() {
  const { boardTheme, setBoardTheme } = useTheme()
  return (
    <div>
      <span data-testid="board-theme">{boardTheme}</span>
      <button onClick={() => setBoardTheme('blue')}>set blue</button>
      <button onClick={() => setBoardTheme('green')}>set green</button>
    </div>
  )
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.getElementById('masterboard-board-theme')?.remove()
    document.getElementById('masterboard-piece-set')?.remove()
  })

  it('defaults to light when no preference stored', () => {
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('light')
  })

  it('toggles to dark and adds .dark class on <html>', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>)
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('persists selection to localStorage', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>)
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(localStorage.getItem('masterboard-theme')).toBe('dark')
  })

  it('throws when useTheme is called outside ThemeProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ThemeConsumer />)).toThrow('useTheme must be used within ThemeProvider')
    spy.mockRestore()
  })

  describe('board theme', () => {
    it('defaults to brown when no preference stored', () => {
      render(<ThemeProvider><BoardThemeConsumer /></ThemeProvider>)
      expect(screen.getByTestId('board-theme').textContent).toBe('brown')
    })

    it('reads boardTheme from localStorage on mount', () => {
      localStorage.setItem('masterboard-boardTheme', 'blue')
      render(<ThemeProvider><BoardThemeConsumer /></ThemeProvider>)
      expect(screen.getByTestId('board-theme').textContent).toBe('blue')
    })

    it('ignores invalid localStorage value and falls back to brown', () => {
      localStorage.setItem('masterboard-boardTheme', 'invalid')
      render(<ThemeProvider><BoardThemeConsumer /></ThemeProvider>)
      expect(screen.getByTestId('board-theme').textContent).toBe('brown')
    })

    it('persists boardTheme to localStorage on change', async () => {
      const user = userEvent.setup()
      render(<ThemeProvider><BoardThemeConsumer /></ThemeProvider>)
      await user.click(screen.getByRole('button', { name: 'set blue' }))
      expect(localStorage.getItem('masterboard-boardTheme')).toBe('blue')
    })

    it('injects empty style for brown theme', () => {
      render(<ThemeProvider><BoardThemeConsumer /></ThemeProvider>)
      const el = document.getElementById('masterboard-board-theme')
      expect(el).not.toBeNull()
      expect(el!.textContent).toBe('')
    })

    it('injects cg-board style for non-brown theme', async () => {
      const user = userEvent.setup()
      render(<ThemeProvider><BoardThemeConsumer /></ThemeProvider>)
      await user.click(screen.getByRole('button', { name: 'set green' }))
      const el = document.getElementById('masterboard-board-theme')
      expect(el?.textContent).toContain('cg-board')
      expect(el?.textContent).toContain('background-image')
      expect(el?.textContent).toContain('background-size: 25% 25%')
    })
  })

  describe('piece set', () => {
    it('defaults to cburnett', () => {
      render(<ThemeProvider><PieceSetConsumer /></ThemeProvider>)
      expect(screen.getByTestId('piece-set').textContent).toBe('cburnett')
    })

    it('reads pieceSet from localStorage on mount', () => {
      localStorage.setItem('masterboard-pieceSet', 'merida')
      render(<ThemeProvider><PieceSetConsumer /></ThemeProvider>)
      expect(screen.getByTestId('piece-set').textContent).toBe('merida')
    })

    it('ignores invalid localStorage value and falls back to cburnett', () => {
      localStorage.setItem('masterboard-pieceSet', 'garbage')
      render(<ThemeProvider><PieceSetConsumer /></ThemeProvider>)
      expect(screen.getByTestId('piece-set').textContent).toBe('cburnett')
    })

    it('persists pieceSet to localStorage on change', async () => {
      const user = userEvent.setup()
      render(<ThemeProvider><PieceSetConsumer /></ThemeProvider>)
      await user.click(screen.getByRole('button', { name: 'set merida' }))
      expect(localStorage.getItem('masterboard-pieceSet')).toBe('merida')
    })

    it('injects style element with merida CSS when set to merida', async () => {
      const user = userEvent.setup()
      render(<ThemeProvider><PieceSetConsumer /></ThemeProvider>)
      await user.click(screen.getByRole('button', { name: 'set merida' }))
      const el = document.getElementById('masterboard-piece-set') as HTMLStyleElement
      expect(el).not.toBeNull()
      expect(el.textContent).toContain('merida-mock')
    })

    it('clears style element when set back to cburnett', async () => {
      const user = userEvent.setup()
      localStorage.setItem('masterboard-pieceSet', 'merida')
      render(<ThemeProvider><PieceSetConsumer /></ThemeProvider>)
      await user.click(screen.getByRole('button', { name: 'set cburnett' }))
      const el = document.getElementById('masterboard-piece-set') as HTMLStyleElement | null
      expect(!el || el.textContent === '').toBe(true)
    })
  })
})

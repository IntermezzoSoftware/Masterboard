import { createContext, useContext, useEffect, useState } from 'react'
import meridaCss     from '@/assets/pieces/merida.css?raw'
import alphaCss      from '@/assets/pieces/alpha.css?raw'
import californiaCss from '@/assets/pieces/california.css?raw'
import stauntyCss    from '@/assets/pieces/staunty.css?raw'
import '@/lib/wailsWindow'

type Theme = 'light' | 'dark'
export type Palette = 'walnut' | 'slate' | 'forest' | 'navy' | 'burgundy'
export type BoardTheme = 'brown' | 'blue' | 'green' | 'purple'

// Square colour pairs (light square, dark square) for each board theme.
// Brown colours are the exact values from chessground.brown.css.
export const BOARD_THEME_COLORS: Record<BoardTheme, { light: string; dark: string }> = {
  brown:  { light: '#f0d9b5', dark: '#b58863' },
  blue:   { light: '#dee3e6', dark: '#8ca2ad' },
  green:  { light: '#ffffdd', dark: '#86a666' },
  purple: { light: '#f0e4cf', dark: '#9b72af' },
}

export const VALID_BOARD_THEMES: BoardTheme[] = ['brown', 'blue', 'green', 'purple']

export type PieceSet = 'cburnett' | 'merida' | 'alpha' | 'california' | 'staunty'
export const VALID_PIECE_SETS: PieceSet[] = ['cburnett', 'merida', 'alpha', 'california', 'staunty']
export const PIECE_SET_LABELS: Record<PieceSet, string> = {
  cburnett:   'Cburnett',
  merida:     'Merida',
  alpha:      'Alpha',
  california: 'California',
  staunty:    'Staunty',
}
const PIECE_SET_CSS: Record<PieceSet, string> = {
  cburnett:   '',
  merida:     meridaCss,
  alpha:      alphaCss,
  california: californiaCss,
  staunty:    stauntyCss,
}

// Token overrides for each non-default palette.
// Walnut is the @theme default — no entry needed.
// Applied via an injected <style> element targeting *, *::before, *::after
// so they beat Tailwind v4's @layer theme rules on every element.
const PALETTE_TOKENS: Partial<Record<Palette, Record<string, string>>> = {
  slate: {
    '--color-accent':              'oklch(38% 0.09 264)',
    '--color-accent-dim':          'oklch(32% 0.07 264)',
    '--color-accent-subtle':       'oklch(88% 0.05 264)',
    '--color-accent-strong':       'oklch(73% 0.09 264)',
    '--color-dark-accent':         'oklch(70% 0.09 264)',
    '--color-dark-accent-subtle':  'oklch(18% 0.04 264)',
    '--color-dark-accent-strong':  'oklch(50% 0.09 264)',
  },
  forest: {
    '--color-accent':              'oklch(36% 0.10 145)',
    '--color-accent-dim':          'oklch(30% 0.08 145)',
    '--color-accent-subtle':       'oklch(89% 0.06 145)',
    '--color-accent-strong':       'oklch(73% 0.10 145)',
    '--color-dark-accent':         'oklch(68% 0.10 145)',
    '--color-dark-accent-subtle':  'oklch(17% 0.05 145)',
    '--color-dark-accent-strong':  'oklch(50% 0.10 145)',
  },
  navy: {
    '--color-accent':              'oklch(37% 0.11 240)',
    '--color-accent-dim':          'oklch(31% 0.09 240)',
    '--color-accent-subtle':       'oklch(88% 0.06 240)',
    '--color-accent-strong':       'oklch(73% 0.11 240)',
    '--color-dark-accent':         'oklch(69% 0.11 240)',
    '--color-dark-accent-subtle':  'oklch(17% 0.05 240)',
    '--color-dark-accent-strong':  'oklch(50% 0.11 240)',
  },
  burgundy: {
    '--color-accent':              'oklch(38% 0.12 12)',
    '--color-accent-dim':          'oklch(32% 0.10 12)',
    '--color-accent-subtle':       'oklch(89% 0.07 12)',
    '--color-accent-strong':       'oklch(73% 0.12 12)',
    '--color-dark-accent':         'oklch(70% 0.12 12)',
    '--color-dark-accent-subtle':  'oklch(18% 0.05 12)',
    '--color-dark-accent-strong':  'oklch(50% 0.12 12)',
  },
}

interface ThemeContextValue {
  theme:         Theme
  toggleTheme:   () => void
  palette:       Palette
  setPalette:    (p: Palette) => void
  boardTheme:    BoardTheme
  setBoardTheme: (t: BoardTheme) => void
  pieceSet:      PieceSet
  setPieceSet:   (s: PieceSet) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const THEME_KEY       = 'masterboard-theme'
const PALETTE_KEY     = 'masterboard-palette'
const BOARD_THEME_KEY = 'masterboard-boardTheme'
const PIECE_SET_KEY   = 'masterboard-pieceSet'
const VALID_PALETTES: Palette[] = ['walnut', 'slate', 'forest', 'navy', 'burgundy']

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialPalette(): Palette {
  const stored = localStorage.getItem(PALETTE_KEY)
  if (stored && (VALID_PALETTES as string[]).includes(stored)) return stored as Palette
  return 'walnut'
}

function getInitialBoardTheme(): BoardTheme {
  const stored = localStorage.getItem(BOARD_THEME_KEY)
  if (stored && (VALID_BOARD_THEMES as string[]).includes(stored)) return stored as BoardTheme
  return 'brown'
}

function getInitialPieceSet(): PieceSet {
  const stored = localStorage.getItem(PIECE_SET_KEY)
  if (stored && (VALID_PIECE_SETS as string[]).includes(stored)) return stored as PieceSet
  return 'cburnett'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme,      setTheme]           = useState<Theme>(getInitialTheme)
  const [palette,    setPaletteState]    = useState<Palette>(getInitialPalette)
  const [boardTheme, setBoardThemeState] = useState<BoardTheme>(getInitialBoardTheme)
  const [pieceSet,   setPieceSetState]   = useState<PieceSet>(getInitialPieceSet)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
    // Sync native title bar colour (Windows 11+; no-op on other platforms)
    window.go?.main?.App?.SetTitleBarTheme(theme === 'dark')?.catch?.(() => {})
  }, [theme])

  useEffect(() => {
    let el = document.getElementById('masterboard-palette') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'masterboard-palette'
      document.head.appendChild(el)
    }
    const tokens = PALETTE_TOKENS[palette]
    if (tokens) {
      const props = Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')
      el.textContent = `*,*::before,*::after{${props}}`
    } else {
      el.textContent = ''  // walnut — @theme defaults apply
    }
    localStorage.setItem(PALETTE_KEY, palette)
  }, [palette])

  useEffect(() => {
    let el = document.getElementById('masterboard-board-theme') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'masterboard-board-theme'
      document.head.appendChild(el)
    }
    if (boardTheme === 'brown') {
      // chessground.brown.css already handles the brown theme.
      el.textContent = ''
    } else {
      const { light, dark } = BOARD_THEME_COLORS[boardTheme]
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">` +
        `<rect width="1" height="1" fill="${light}"/>` +
        `<rect x="1" width="1" height="1" fill="${dark}"/>` +
        `<rect y="1" width="1" height="1" fill="${dark}"/>` +
        `<rect x="1" y="1" width="1" height="1" fill="${light}"/>` +
        `</svg>`
      const encoded = btoa(svg)
      el.textContent = `cg-board { background-image: url("data:image/svg+xml;base64,${encoded}"); background-size: 25% 25%; }`
    }
    localStorage.setItem(BOARD_THEME_KEY, boardTheme)
  }, [boardTheme])

  useEffect(() => {
    let el = document.getElementById('masterboard-piece-set') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'masterboard-piece-set'
      document.head.appendChild(el)
    }
    el.textContent = PIECE_SET_CSS[pieceSet]
    localStorage.setItem(PIECE_SET_KEY, pieceSet)
  }, [pieceSet])

  const toggleTheme   = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))
  const setPalette    = (p: Palette) => setPaletteState(p)
  const setBoardTheme = (t: BoardTheme) => setBoardThemeState(t)
  const setPieceSet   = (s: PieceSet) => setPieceSetState(s)

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, palette, setPalette, boardTheme, setBoardTheme, pieceSet, setPieceSet }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

// Suitable for use as an SVG stroke colour (e.g. chessground DrawBrush.color).
export function getAccentColor(palette: Palette, theme: 'light' | 'dark'): string {
  if (theme === 'dark') {
    const tokens = PALETTE_TOKENS[palette]
    return tokens?.['--color-dark-accent'] ?? 'oklch(72% 0.12 47)'
  }
  const tokens = PALETTE_TOKENS[palette]
  return tokens?.['--color-accent'] ?? 'oklch(40% 0.12 47)'
}

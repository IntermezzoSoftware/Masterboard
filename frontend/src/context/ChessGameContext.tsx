import { createContext, useContext } from 'react'
import { useChessGame } from '@/hooks/useChessGame'

type ChessGameContextValue = ReturnType<typeof useChessGame>

const ChessGameContext = createContext<ChessGameContextValue | null>(null)

export function ChessGameProvider({ children }: { children: React.ReactNode }) {
  const game = useChessGame()
  return <ChessGameContext.Provider value={game}>{children}</ChessGameContext.Provider>
}

export function useChessGameContext(): ChessGameContextValue {
  const ctx = useContext(ChessGameContext)
  if (!ctx) throw new Error('useChessGameContext must be used inside ChessGameProvider')
  return ctx
}

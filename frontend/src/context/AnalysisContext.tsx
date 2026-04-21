import { createContext, useContext } from 'react'
import { useGameAnalysis, type GameAnalysisHook } from '@/hooks/useGameAnalysis'

const AnalysisContext = createContext<GameAnalysisHook | null>(null)

export function AnalysisProvider({
  gameId,
  children,
}: {
  gameId: string | null
  children: React.ReactNode
}) {
  const analysis = useGameAnalysis(gameId)
  return <AnalysisContext.Provider value={analysis}>{children}</AnalysisContext.Provider>
}

export function useAnalysisContext(): GameAnalysisHook {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error('useAnalysisContext must be used within AnalysisProvider')
  return ctx
}

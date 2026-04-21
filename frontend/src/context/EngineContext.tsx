import { createContext, useContext, useMemo } from 'react'
import { useEngineAnalysis, type EngineAnalysisHook } from '@/hooks/useEngineAnalysis'

const EngineContext = createContext<EngineAnalysisHook | null>(null)

export function EngineProvider({
  fen,
  navigateToPV,
  children,
}: {
  fen: string
  navigateToPV?: (analysisFen: string, uciMoves: string[]) => void
  children: React.ReactNode
}) {
  const engine = useEngineAnalysis(fen)
  const value = useMemo(
    () => ({ ...engine, navigateToPV }),
    [
      engine.fen, engine.isReady, engine.isAnalysing, engine.lines, engine.currentDepth,
      engine.analysisFen, engine.multiPV, engine.showArrows,
      engine.availableEngines, engine.activeEngine, engine.engineName, engine.engineType,
      engine.startAnalysis, engine.stopAnalysis, engine.setMultiPV,
      engine.toggleArrows, engine.setActiveEngine, navigateToPV,
    ],
  )
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}

export function useEngineContext(): EngineAnalysisHook {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngineContext must be used inside EngineProvider')
  return ctx
}

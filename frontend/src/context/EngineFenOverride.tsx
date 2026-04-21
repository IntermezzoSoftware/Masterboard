import { createContext, useContext, useState, useCallback } from 'react'

interface EngineFenOverrideValue {
  /** When non-null, the engine should analyse this FEN instead of the ChessGameContext FEN. */
  fen: string | null
  set: (fen: string | null) => void
}

const EngineFenOverrideContext = createContext<EngineFenOverrideValue>({ fen: null, set: () => {} })

export function EngineFenOverrideProvider({ children }: { children: React.ReactNode }) {
  const [fen, setFen] = useState<string | null>(null)
  const set = useCallback((f: string | null) => setFen(f), [])
  return <EngineFenOverrideContext.Provider value={{ fen, set }}>{children}</EngineFenOverrideContext.Provider>
}

export function useEngineFenOverride() {
  return useContext(EngineFenOverrideContext)
}

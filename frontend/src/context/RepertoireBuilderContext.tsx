import { createContext, useContext } from 'react'
import type { RepertoireBuilderHook } from '@/hooks/useRepertoireBuilder'

const RepertoireBuilderContext = createContext<RepertoireBuilderHook | null>(null)

export const RepertoireBuilderProvider = RepertoireBuilderContext.Provider

export function useRepertoireBuilderContext(): RepertoireBuilderHook {
  const ctx = useContext(RepertoireBuilderContext)
  if (!ctx) throw new Error('useRepertoireBuilderContext must be used within RepertoireBuilderProvider')
  return ctx
}

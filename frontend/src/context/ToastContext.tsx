import { createContext, useCallback, useContext, useState } from 'react'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error'
  dismissing?: boolean
}

// Split into two contexts so components calling showToast don't re-render on
// every toast state change — only the Toaster (which reads state) does.
const ToastDispatchContext = createContext<((message: string, type?: 'success' | 'error') => void) | null>(null)
const ToastStateContext = createContext<{ toasts: ToastItem[]; removeToast: (id: number) => void } | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 150)
  }, [])

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => dismiss(id), 2500)
  }, [dismiss])

  const removeToast = dismiss

  return (
    <ToastDispatchContext.Provider value={showToast}>
      <ToastStateContext.Provider value={{ toasts, removeToast }}>
        {children}
      </ToastStateContext.Provider>
    </ToastDispatchContext.Provider>
  )
}

/** Returns the showToast function. Components using this won't re-render when toasts change. */
export function useToast() {
  const fn = useContext(ToastDispatchContext)
  if (!fn) throw new Error('useToast must be used inside ToastProvider')
  return fn
}

/** Used by Toaster only. */
export function useToastState() {
  const ctx = useContext(ToastStateContext)
  if (!ctx) throw new Error('useToastState must be used inside ToastProvider')
  return ctx
}

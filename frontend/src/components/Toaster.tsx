import { Check, AlertCircle, X } from 'lucide-react'
import { useToastState } from '@/context/ToastContext'

export default function Toaster() {
  const { toasts, removeToast } = useToastState()

  if (toasts.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          role="status"
          className={[
            'flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-[var(--radius-sm)] shadow-md',
            'text-xs font-medium pointer-events-auto',
            toast.dismissing
              ? 'animate-[toast-out_0.15s_ease-in_forwards]'
              : 'animate-toast-in',
            toast.type === 'success'
              ? [
                  'bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-2)]',
                  'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
                  'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
                ].join(' ')
              : [
                  'bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-2)]',
                  'text-red-700 dark:text-red-400',
                  'border border-red-200 dark:border-red-800',
                ].join(' '),
          ].join(' ')}
        >
          {toast.type === 'success'
            ? <Check size={13} strokeWidth={2.5} className="text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] shrink-0" aria-hidden="true" />
            : <AlertCircle size={13} strokeWidth={2} className="text-red-500 shrink-0" aria-hidden="true" />
          }
          <span>{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss notification"
            className="ml-0.5 p-0.5 rounded opacity-40 hover:opacity-80 transition-opacity cursor-pointer"
          >
            <X size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

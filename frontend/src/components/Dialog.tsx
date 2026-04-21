import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, createContext, useContext } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

const DialogCloseContext = createContext<(() => void) | null>(null)

/** Returns the animated-close function from the nearest Dialog. */
export function useDialogClose() {
  const close = useContext(DialogCloseContext)
  if (!close) throw new Error('useDialogClose must be used inside <Dialog>')
  return close
}

/** Wrap a button to trigger the animated exit. With asChild, the child's own onClick fires first, then close. */
export function DialogClose({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) {
  const close = useContext(DialogCloseContext)
  if (asChild && isValidElement<{ onClick?: React.MouseEventHandler }>(children)) {
    return cloneElement(children, {
      onClick: (e: React.MouseEvent) => {
        children.props.onClick?.(e)
        close?.()
      },
    })
  }
  return <button onClick={() => close?.()}>{children}</button>
}

type MaxWidth = 'xs' | 'sm' | 'md' | '2xl'

interface DialogProps {
  onClose: () => void
  title: React.ReactNode
  maxWidth?: MaxWidth
  children: React.ReactNode
  className?: string
}

const maxWidthClass: Record<MaxWidth, string> = {
  xs:  'max-w-xs',
  sm:  'max-w-sm',
  md:  'max-w-md',
  '2xl': 'max-w-2xl',
}

const EXIT_DURATION = 100

export function Dialog({ onClose, title, maxWidth = 'sm', children, className }: DialogProps) {
  const [isClosing, setIsClosing] = useState(false)
  const closingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timer on unmount to prevent calling onClose after unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setIsClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onClose()
    }, EXIT_DURATION)
  }, [onClose])

  return (
    <RadixDialog.Root open onOpenChange={open => { if (!open) handleClose() }}>
      <RadixDialog.Portal forceMount>
        <RadixDialog.Overlay
          className={[
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            isClosing
              ? 'animate-[dialog-overlay-out_100ms_ease-in_forwards]'
              : 'animate-[dialog-overlay-in_150ms_ease-out]',
          ].join(' ')}
        />
        <RadixDialog.Content
          className="fixed inset-0 z-50 overflow-y-auto"
          // Prevent Radix from warning about missing description; our title is sufficient.
          aria-describedby={undefined}
        >
          <div className="flex min-h-full items-center justify-center p-4">
            <div className={[
              `relative w-full ${maxWidthClass[maxWidth]} rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-2xl flex flex-col`,
              isClosing
                ? 'animate-[dialog-content-out_100ms_ease-in_forwards]'
                : 'animate-[dialog-content-in_150ms_ease-out]',
              className ?? '',
            ].join(' ')}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
                <RadixDialog.Title asChild>
                  <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{title}</h2>
                </RadixDialog.Title>
                <RadixDialog.Close asChild>
                  <button
                    aria-label="Close"
                    className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </RadixDialog.Close>
              </div>
              <DialogCloseContext.Provider value={handleClose}>
                {children}
              </DialogCloseContext.Provider>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, FlipVertical2 } from 'lucide-react'

interface BoardControlsProps {
  canGoBack: boolean
  canGoForward: boolean
  onGoToStart: () => void
  onGoBack: () => void
  onGoForward: () => void
  onGoToEnd: () => void
  onFlip: () => void
}

const BASE = 'flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] transition-colors'
const ACTIVE = [
  'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]',
  'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
  'hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]',
  'cursor-pointer',
].join(' ')
const DISABLED = [
  'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]',
  'opacity-30 cursor-default',
].join(' ')

function ControlButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      aria-disabled={disabled}
      className={`${BASE} ${disabled ? DISABLED : ACTIVE}`}
    >
      {children}
    </button>
  )
}

export default function BoardControls({
  canGoBack,
  canGoForward,
  onGoToStart,
  onGoBack,
  onGoForward,
  onGoToEnd,
  onFlip,
}: BoardControlsProps) {
  return (
    <div className="flex items-center justify-between h-12 px-1">
      <div className="flex items-center gap-1">
        <ControlButton onClick={onGoToStart} disabled={!canGoBack} label="Go to start">
          <ChevronFirst size={16} strokeWidth={1.75} aria-hidden="true" />
        </ControlButton>
        <ControlButton onClick={onGoBack} disabled={!canGoBack} label="Previous move">
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        </ControlButton>
        <ControlButton onClick={onGoForward} disabled={!canGoForward} label="Next move">
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </ControlButton>
        <ControlButton onClick={onGoToEnd} disabled={!canGoForward} label="Go to end">
          <ChevronLast size={16} strokeWidth={1.75} aria-hidden="true" />
        </ControlButton>
      </div>
      <div className="flex items-center gap-1">
        <ControlButton onClick={onFlip} disabled={false} label="Flip board">
          <FlipVertical2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </ControlButton>
      </div>
    </div>
  )
}

import * as RadixCheckbox from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'

interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onCheckedChange?: (checked: boolean | 'indeterminate') => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Checkbox({ checked, onCheckedChange, disabled, className, 'aria-label': ariaLabel }: CheckboxProps) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={[
        'w-[14px] h-[14px] shrink-0 rounded-[var(--radius-sm)] border',
        'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
        'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
        'data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]',
        'dark:data-[state=checked]:bg-[var(--color-dark-accent)] dark:data-[state=checked]:border-[var(--color-dark-accent)]',
        'data-[state=indeterminate]:bg-[var(--color-accent)] data-[state=indeterminate]:border-[var(--color-accent)]',
        'dark:data-[state=indeterminate]:bg-[var(--color-dark-accent)] dark:data-[state=indeterminate]:border-[var(--color-dark-accent)]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-1',
        'focus-visible:ring-[var(--color-accent)] dark:focus-visible:ring-[var(--color-dark-accent)]',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        'transition-colors duration-100',
        className ?? '',
      ].join(' ')}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center text-white dark:text-[var(--color-dark-surface-0)]">
        {checked === 'indeterminate'
          ? <Minus size={9} strokeWidth={3} />
          : <Check size={9} strokeWidth={3} />}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}

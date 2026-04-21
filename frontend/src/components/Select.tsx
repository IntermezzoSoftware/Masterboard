import * as RadixSelect from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  /** 'sm' = formSelect (text-sm), 'xs' = filterSelect (text-xs). Default 'sm'. */
  size?: 'sm' | 'xs'
  'aria-label'?: string
}

// Radix Select treats empty string as "no value" (shows placeholder).
// We remap '' ↔ '__none__' at the boundary so empty-string options work.
const NONE = '__none__'
function toInternal(v: string) { return v === '' ? NONE : v }
function toExternal(v: string) { return v === NONE ? '' : v }

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = 'sm',
  'aria-label': ariaLabel,
}: SelectProps) {
  const isXs = size === 'xs'

  const triggerClass = [
    'inline-flex items-center justify-between gap-1 w-full',
    'appearance-none rounded-[var(--radius-sm)]',
    isXs ? 'pl-2 pr-1.5 py-1' : 'pl-2 pr-1.5 py-1.5',
    'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
    'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
    isXs
      ? 'text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]'
      : 'text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
    'hover:border-[var(--color-content-tertiary)] dark:hover:border-[var(--color-dark-content-tertiary)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] dark:focus:ring-[var(--color-dark-accent)]',
    'transition-colors cursor-pointer',
    'data-[placeholder]:text-[var(--color-content-tertiary)] dark:data-[placeholder]:text-[var(--color-dark-content-tertiary)]',
    className ?? '',
  ].join(' ')

  const contentClass = [
    'z-50 min-w-[var(--radix-select-trigger-width)] py-1',
    'rounded-[var(--radius-md)] shadow-lg',
    'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
    'bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]',
  ].join(' ')

  const itemClass = [
    'flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer outline-none',
    isXs ? 'text-xs' : 'text-sm',
    'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
    'data-[highlighted]:bg-[var(--color-surface-2)] dark:data-[highlighted]:bg-[var(--color-dark-surface-2)]',
    'data-[state=checked]:text-[var(--color-accent)] dark:data-[state=checked]:text-[var(--color-dark-accent)]',
  ].join(' ')

  return (
    <RadixSelect.Root value={toInternal(value)} onValueChange={v => onValueChange(toExternal(v))}>
      <RadixSelect.Trigger className={triggerClass} aria-label={ariaLabel}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="flex-none shrink-0">
          <ChevronDown size={isXs ? 10 : 11} className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={4} className={contentClass}>
          <RadixSelect.Viewport>
            {options.map(opt => (
              <RadixSelect.Item key={opt.value} value={toInternal(opt.value)} className={itemClass}>
                <RadixSelect.ItemIndicator>
                  <Check size={10} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

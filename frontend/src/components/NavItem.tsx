import { NavLink } from 'react-router'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  to: string
  icon: LucideIcon
  label: string
  collapsed?: boolean
}

export default function NavItem({ to, icon: Icon, label, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] text-sm font-medium overflow-hidden transition-all duration-150 shrink-0',
          isActive
            ? 'shadow-[inset_3px_0_0_var(--color-accent)] dark:shadow-[inset_3px_0_0_var(--color-dark-accent)] bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
            : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
        ].join(' ')
      }
    >
      <Icon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className={collapsed ? 'max-w-0 overflow-hidden whitespace-nowrap' : 'whitespace-nowrap'}>{label}</span>
    </NavLink>
  )
}

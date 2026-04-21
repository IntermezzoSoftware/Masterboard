/**
 * Shared Tailwind CSS class strings used across form inputs, labels, and
 * buttons. Import from here instead of repeating inline.
 */

export const formInput = [
  'w-full px-2 py-1.5 text-sm rounded-[var(--radius-sm)]',
  'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
  'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
  'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
  'focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] dark:focus:ring-[var(--color-dark-accent)]',
  '[color-scheme:light] dark:[color-scheme:dark]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ')

export const formLabel = 'block text-xs font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mb-1'

export const btnPrimary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap bg-[var(--color-accent-strong)] dark:bg-[var(--color-dark-accent-strong)] text-[var(--color-content-primary)] dark:text-white border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] hover:bg-[var(--color-accent-strong-hover)] dark:hover:bg-[var(--color-dark-accent-strong-hover)] disabled:opacity-50 active:scale-[0.97] transition-all duration-100'

export const btnSecondary = [
  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap',
  'bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)]',
  'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
  'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
  'hover:bg-[var(--color-surface-3)] dark:hover:bg-[var(--color-dark-surface-3)] active:scale-[0.98] transition-all duration-100',
].join(' ')

export const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] active:scale-[0.98] transition-all duration-100'


export const btnDanger = 'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap bg-[var(--color-danger-strong)] text-white border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] hover:bg-[var(--color-danger-strong-hover)] dark:hover:bg-[var(--color-dark-danger-strong-hover)] active:scale-[0.97] transition-all duration-100'

export const btnToolbar = 'flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors cursor-pointer text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'

export const btnCompact = 'px-2.5 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] active:scale-[0.97] transition-all duration-100 cursor-pointer'

export const btnLink = 'text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer transition-colors'

// Menu item for hand-rolled (non-Radix) dropdowns
export const menuItemDropdown = 'w-full text-left flex items-center gap-2 px-3 py-2 text-xs cursor-pointer text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors'

// Stone palette: warm-neutral, visually distinct from the app accent colour.
export const btnWhiteSide = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--color-surface-0)] dark:bg-[#e0e0e0] text-[#1a1a1a] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] hover:bg-[#d8d8d8] dark:hover:bg-[#cecece] transition-colors'
export const btnBlackSide = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[#484848] dark:bg-[#333] text-white border border-[var(--color-surface-3)] dark:border-[#505050] hover:bg-[#383838] dark:hover:bg-[#424242] transition-colors'

// Tighter vertical padding for use inside the titlebar where vertical space is limited.
export const btnTitlebarPrimary = 'inline-flex items-center gap-1.5 px-3 py-[5px] text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap bg-[var(--color-accent-strong)] dark:bg-[var(--color-dark-accent-strong)] text-[var(--color-content-primary)] dark:text-white border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] hover:bg-[var(--color-accent-strong-hover)] dark:hover:bg-[var(--color-dark-accent-strong-hover)] disabled:opacity-50 active:scale-[0.97] transition-all duration-100'

export const btnTitlebarSecondary = [
  'flex items-center gap-1.5 px-3 py-[5px] text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap',
  'bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)]',
  'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
  'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
  'hover:bg-[var(--color-surface-3)] dark:hover:bg-[var(--color-dark-surface-3)] active:scale-[0.98] transition-all duration-100',
].join(' ')

export const btnTitlebarGhost = 'inline-flex items-center gap-1.5 px-3 py-[5px] text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] active:scale-[0.98] transition-all duration-100'

export const btnTitlebarDanger = 'px-3 py-[5px] text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap bg-[var(--color-danger-strong)] text-white border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] hover:bg-[var(--color-danger-strong-hover)] dark:hover:bg-[var(--color-dark-danger-strong-hover)] active:scale-[0.97] transition-all duration-100'

export const btnTitlebarWhiteSide = 'inline-flex items-center gap-1.5 px-3 py-[5px] text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--color-surface-0)] dark:bg-[#e0e0e0] text-[#1a1a1a] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] hover:bg-[#d8d8d8] dark:hover:bg-[#cecece] transition-colors'
export const btnTitlebarBlackSide = 'inline-flex items-center gap-1.5 px-3 py-[5px] text-xs font-medium rounded-[var(--radius-sm)] bg-[#484848] dark:bg-[#333] text-white border border-[var(--color-surface-3)] dark:border-[#505050] hover:bg-[#383838] dark:hover:bg-[#424242] transition-colors'

export const collectionToggle = [
  'px-2 py-1 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors select-none',
  'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
  'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]',
  'hover:border-[var(--color-content-tertiary)] dark:hover:border-[var(--color-dark-content-tertiary)]',
].join(' ')

export const collectionToggleActive = [
  'px-2 py-1 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors select-none',
  'border border-[var(--color-accent)] dark:border-[var(--color-dark-accent)]',
  'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white',
].join(' ')


export const menuContent = 'z-50 min-w-[160px] py-1 rounded-[var(--radius-md)] shadow-lg border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]'
const menuItemBase = 'w-full text-left px-3 py-1.5 text-sm cursor-pointer outline-none data-[highlighted]:bg-[var(--color-surface-2)] dark:data-[highlighted]:bg-[var(--color-dark-surface-2)]'
export const menuItemNormal = `${menuItemBase} text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]`
export const menuItemDestructive = `${menuItemBase} text-red-600 dark:text-red-400`
export const menuItemActive = `${menuItemBase} text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] font-medium`
export const menuSeparator = 'my-1 h-px bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]'
export const menuItemCompact = 'w-full text-left px-2 py-1 text-xs cursor-pointer outline-none data-[highlighted]:bg-[var(--color-surface-2)] dark:data-[highlighted]:bg-[var(--color-dark-surface-2)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]'

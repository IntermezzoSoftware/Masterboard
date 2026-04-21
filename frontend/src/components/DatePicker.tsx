import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

// How many years to show per page in the year grid
const YEAR_PAGE = 12

function formatDisplay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function startOffset(year: number, month: number): number {
  const jsDay = new Date(year, month, 1).getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

function parseIso(iso: string): { year: number; month: number; day: number } | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

// Start of the year-page that contains `year`
function yearPageStart(year: number): number {
  return Math.floor(year / YEAR_PAGE) * YEAR_PAGE
}

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

type View = 'day' | 'year'

export function DatePicker({ value, onChange, placeholder = 'Pick a date', className }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('day')
  const today = new Date()

  const parsed = parseIso(value)

  const [viewYear, setViewYear] = useState(() => parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => parsed?.month ?? today.getMonth())

  // The first year shown on the current year-grid page
  const [yearPageBase, setYearPageBase] = useState(() => yearPageStart(parsed?.year ?? today.getFullYear()))

  function handleOpenChange(o: boolean) {
    setOpen(o)
    if (o) {
      const p = parseIso(value)
      const y = p?.year ?? today.getFullYear()
      setViewYear(y)
      setViewMonth(p?.month ?? today.getMonth())
      setYearPageBase(yearPageStart(y))
      setView('day')
    }
  }


  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  function selectDay(day: number) {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(iso)
    setOpen(false)
  }


  function openYearView() {
    setYearPageBase(yearPageStart(viewYear))
    setView('year')
  }

  function selectYear(year: number) {
    setViewYear(year)
    setView('day')
  }


  function clearDate(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
  }


  const triggerClass = [
    'inline-flex items-center gap-1.5 w-full',
    'appearance-none px-2 py-1 rounded-[var(--radius-sm)]',
    'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
    'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
    'text-xs',
    value
      ? 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]'
      : 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]',
    'hover:border-[var(--color-content-tertiary)] dark:hover:border-[var(--color-dark-content-tertiary)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] dark:focus:ring-[var(--color-dark-accent)]',
    'transition-colors cursor-pointer',
    className ?? '',
  ].join(' ')

  const navBtnClass = [
    'flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)]',
    'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]',
    'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
    'hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]',
    'transition-colors',
  ].join(' ')


  const totalDays = daysInMonth(viewYear, viewMonth)
  const offset = startOffset(viewYear, viewMonth)
  const years = Array.from({ length: YEAR_PAGE }, (_, i) => yearPageBase + i)

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className={triggerClass}>
          <CalendarDays size={11} className="flex-none shrink-0 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]" />
          <span className="flex-1 text-left truncate">
            {value ? formatDisplay(value) : placeholder}
          </span>
          {value && (
            <span
              role="button"
              aria-label="Clear date"
              onClick={clearDate}
              className="flex-none text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors"
            >
              <X size={10} />
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className={[
            'z-50 p-3 w-[220px]',
            'rounded-[var(--radius-md)] shadow-xl',
            'border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]',
            'bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]',
            'select-none',
          ].join(' ')}
        >
          {view === 'year' ? (
            <>
              {/* Year page navigation */}
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={() => setYearPageBase(b => b - YEAR_PAGE)} className={navBtnClass} aria-label="Previous years">
                  <ChevronLeft size={13} />
                </button>
                <span className="text-xs font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                  {yearPageBase}–{yearPageBase + YEAR_PAGE - 1}
                </span>
                <button type="button" onClick={() => setYearPageBase(b => b + YEAR_PAGE)} className={navBtnClass} aria-label="Next years">
                  <ChevronRight size={13} />
                </button>
              </div>

              {/* Year grid: 4 columns × 3 rows */}
              <div className="grid grid-cols-4 gap-1">
                {years.map(year => {
                  const isSelected = year === viewYear
                  const isThisYear = year === today.getFullYear()
                  return (
                    <button
                      key={year}
                      type="button"
                      onClick={() => selectYear(year)}
                      className={[
                        'flex items-center justify-center h-7 text-xs rounded-[var(--radius-sm)] transition-colors',
                        isSelected
                          ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white font-medium'
                          : isThisYear
                            ? 'font-semibold text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'
                            : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
                      ].join(' ')}
                    >
                      {year}
                    </button>
                  )
                })}
              </div>

              {/* Month quick-pick below the year grid */}
              <div className="grid grid-cols-4 gap-1 mt-2 pt-2 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
                {MONTH_SHORT.map((name, i) => {
                  const isSelected = i === viewMonth
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => { setViewMonth(i); setView('day') }}
                      className={[
                        'flex items-center justify-center h-7 text-xs rounded-[var(--radius-sm)] transition-colors',
                        isSelected
                          ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white font-medium'
                          : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
                      ].join(' ')}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={prevMonth} className={navBtnClass} aria-label="Previous month">
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  onClick={openYearView}
                  className="text-xs font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:text-[var(--color-accent)] dark:hover:text-[var(--color-dark-accent)] transition-colors px-1 rounded"
                  aria-label="Pick year"
                >
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </button>
                <button type="button" onClick={nextMonth} className={navBtnClass} aria-label="Next month">
                  <ChevronRight size={13} />
                </button>
              </div>

              {/* Day-of-week header */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_LABELS.map(d => (
                  <div key={d} className="flex items-center justify-center text-[10px] font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] h-6">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7">
                {Array.from({ length: offset }, (_, i) => <div key={`pad-${i}`} />)}
                {Array.from({ length: totalDays }, (_, i) => {
                  const day = i + 1
                  const isSelected =
                    parsed !== null &&
                    day === parsed.day &&
                    viewYear === parsed.year &&
                    viewMonth === parsed.month
                  const isToday =
                    day === today.getDate() &&
                    viewYear === today.getFullYear() &&
                    viewMonth === today.getMonth()

                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={[
                        'flex items-center justify-center h-7 w-full text-xs rounded-[var(--radius-sm)] transition-colors',
                        isSelected
                          ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white font-medium'
                          : isToday
                            ? 'font-semibold text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'
                            : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
                      ].join(' ')}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

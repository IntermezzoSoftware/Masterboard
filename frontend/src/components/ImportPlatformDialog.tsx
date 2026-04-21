import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { Checkbox } from '@/components/Checkbox'
import { ResultBadge } from '@/components/ResultBadge'
import { Select } from '@/components/Select'
import { DatePicker } from '@/components/DatePicker'
import { formInput, formLabel, collectionToggle, collectionToggleActive, btnPrimary, btnGhost } from '@/lib/classNames'
import { api, type Collection, type Folder, type GameInput, type ImportFilters } from '@/lib/api'
import { formatTimeControl } from '@/lib/gameFormatters'

interface ImportPlatformDialogProps {
  platform: 'lichess' | 'chesscom'
  initialUsername?: string
  initialMaxGames?: string
  initialFolderId?: string | null
  autoFetch?: boolean
  folders?: Folder[]
  collections?: Collection[]
  onImported: (count: number, duplicates: number) => void
  onClose: () => void
}

const TIME_CONTROL_OPTIONS = [
  { value: 'bullet',         label: 'Bullet'          },
  { value: 'blitz',          label: 'Blitz'           },
  { value: 'rapid',          label: 'Rapid'           },
  { value: 'classical',      label: 'Classical'       },
  { value: 'correspondence', label: 'Correspondence'  },
]

type ImportStep = 'configure' | 'preview'

function ImportButton({ onClick, disabled, label }: { onClick: () => Promise<boolean>; disabled: boolean; label: string }) {
  const close = useDialogClose()
  return (
    <button
      onClick={async () => { const ok = await onClick(); if (ok) close() }}
      disabled={disabled}
      className={btnPrimary}
    >
      {label}
    </button>
  )
}

export function ImportPlatformDialog({ platform, initialUsername, initialMaxGames, initialFolderId, autoFetch, folders = [], collections = [], onImported, onClose }: ImportPlatformDialogProps) {
  const [step, setStep]                 = useState<ImportStep>('configure')
  const [username, setUsername]         = useState(initialUsername ?? '')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [timeControls, setTimeControls] = useState<Set<string>>(new Set())
  const [maxGames, setMaxGames]         = useState(initialMaxGames ?? '50')
  const [targetFolderId, setTargetFolderId] = useState<string>(initialFolderId ?? '')
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set())
  const [fetching, setFetching]         = useState(autoFetch ?? false)
  const [importing, setImporting]       = useState(false)
  const [error, setError]               = useState('')
  const [previewGames, setPreviewGames] = useState<GameInput[]>([])
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const PREVIEW_PAGE = 20
  const [visibleCount, setVisibleCount] = useState(PREVIEW_PAGE)

  const title = platform === 'lichess' ? 'Import from Lichess' : 'Import from Chess.com'

  async function handleFetchPreview() {
    if (!username.trim()) { setError('Username is required'); return }
    setFetching(true)
    setError('')
    try {
      const filters: ImportFilters = {
        dateFrom:     dateFrom || undefined,
        dateTo:       dateTo   || undefined,
        timeControls: timeControls.size > 0 ? [...timeControls] : undefined,
        maxGames:     maxGames ? parseInt(maxGames, 10) : undefined,
      }
      const games = platform === 'lichess'
        ? await api.previewFromLichess(username.trim(), filters)
        : await api.previewFromChessCom(username.trim(), filters)
      const list = games ?? []
      setPreviewGames(list)
      setSelected(new Set(list.map((_, i) => i)))
      setVisibleCount(PREVIEW_PAGE)
      setStep('preview')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch games')
    } finally {
      setFetching(false)
    }
  }

  // Auto-fetch on mount when opened via quick-sync (username already known)
  const didAutoFetch = useRef(false)
  useEffect(() => {
    if (autoFetch && !didAutoFetch.current) {
      didAutoFetch.current = true
      handleFetchPreview()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleImportSelected(): Promise<boolean> {
    const chosen = previewGames.filter((_, i) => selected.has(i))
    if (!chosen.length) return false
    setImporting(true)
    setError('')
    try {
      const ids = (await api.importSelectedGames(chosen)) ?? []
      if (targetFolderId && ids.length > 0) {
        await Promise.all(ids.map(id => api.moveGameToFolder(id, targetFolderId)))
      }
      if (selectedCollections.size > 0 && ids.length > 0) {
        await Promise.all(ids.flatMap(id =>
          [...selectedCollections].map(cid => api.addGameToCollection(id, cid))
        ))
      }
      onImported(ids.length, chosen.length - ids.length)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
      return false
    } finally {
      setImporting(false)
    }
  }

  function toggleAll() {
    if (selected.size === previewGames.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(previewGames.map((_, i) => i)))
    }
  }

  function toggleOne(i: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const allChecked  = previewGames.length > 0 && selected.size === previewGames.length
  const someChecked = selected.size > 0 && selected.size < previewGames.length

  const dialogTitle = step === 'preview'
    ? `${title} — ${previewGames.length} game${previewGames.length === 1 ? '' : 's'} fetched`
    : title

  return (
    <Dialog onClose={onClose} title={dialogTitle} maxWidth={step === 'preview' ? '2xl' : 'sm'}>
      {step === 'configure' && fetching ? (
        <div className="flex items-center justify-center px-4 py-12 text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
          Loading preview…
        </div>
      ) : step === 'configure' ? (
        <>
          <div className="px-4 py-4 flex flex-col gap-3">
            <div>
              <label htmlFor="import-username" className={formLabel}>Username</label>
              <input id="import-username" className={formInput} value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. DrNykterstein" autoFocus={!initialUsername} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={formLabel}>From date</label>
                <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="From date" />
              </div>
              <div>
                <label className={formLabel}>To date</label>
                <DatePicker value={dateTo} onChange={setDateTo} placeholder="To date" />
              </div>
            </div>
            <div>
              <label className={formLabel}>Time controls <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] font-normal">(all if none selected)</span></label>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                {TIME_CONTROL_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setTimeControls(prev => { const next = new Set(prev); next.has(o.value) ? next.delete(o.value) : next.add(o.value); return next })}
                    className={`${timeControls.has(o.value) ? collectionToggleActive : collectionToggle} w-full text-center`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-24">
              <label htmlFor="import-max-games" className={formLabel}>Max games</label>
              <input id="import-max-games" type="number" className={formInput} value={maxGames} onChange={e => setMaxGames(e.target.value)} min="1" max="1000" />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
            <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
            <button onClick={handleFetchPreview} disabled={fetching} className={btnPrimary}>
              {fetching ? 'Fetching…' : 'Preview'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="overflow-auto flex-1">
            {previewGames.length === 0 ? (
              <p className="px-4 py-8 text-xs text-center text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">No games found for these filters.</p>
            ) : (
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]">
                  <tr className="border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
                    <th className="px-3 py-2 w-8">
                      <Checkbox
                        checked={someChecked ? 'indeterminate' : allChecked}
                        onCheckedChange={() => toggleAll()}
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">White</th>
                    <th className="px-3 py-2 text-left font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">Black</th>
                    <th className="px-3 py-2 text-left font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">Result</th>
                    <th className="px-3 py-2 text-left font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">TC</th>
                  </tr>
                </thead>
                <tbody>
                  {previewGames.slice(0, visibleCount).map((g, i) => (
                    <tr
                      key={i}
                      onClick={() => toggleOne(i)}
                      className={`border-b border-[var(--color-surface-2)] dark:border-[var(--color-dark-surface-2)] cursor-pointer transition-colors ${selected.has(i) ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)]' : 'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'}`}
                    >
                      <td className="px-3 py-1.5 w-8" onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleOne(i)} />
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] max-w-[120px] truncate">
                        {g.white}{g.whiteElo ? ` (${g.whiteElo})` : ''}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] max-w-[120px] truncate">
                        {g.black}{g.blackElo ? ` (${g.blackElo})` : ''}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap"><ResultBadge result={g.result} /></td>
                      <td className="px-3 py-1.5 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] whitespace-nowrap">{(g.date ?? '').slice(0, 10)}</td>
                      <td className="px-3 py-1.5 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] whitespace-nowrap">{formatTimeControl(g.timeControl ?? '')}</td>
                    </tr>
                  ))}
                  {visibleCount < previewGames.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-2 text-center">
                        <button
                          onClick={() => setVisibleCount(c => Math.min(c + PREVIEW_PAGE, previewGames.length))}
                          className="text-xs text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline"
                        >
                          Show {Math.min(PREVIEW_PAGE, previewGames.length - visibleCount)} more
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          {error && <p className="px-4 py-2 text-xs text-red-600 dark:text-red-400 shrink-0">{error}</p>}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
            <button onClick={() => { setStep('configure'); setError('') }} className={btnGhost}>← Back</button>
            <div className="flex items-center gap-3">
              {folders.length > 0 && (
                <Select
                  value={targetFolderId}
                  onValueChange={setTargetFolderId}
                  aria-label="Save to folder"
                  size="xs"
                  options={[
                    { value: '', label: 'No folder' },
                    ...folders.map(f => ({ value: f.id, label: f.name })),
                  ]}
                />
              )}
              {collections.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {collections.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCollections(prev => { const next = new Set(prev); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next })}
                      className={selectedCollections.has(c.id) ? collectionToggleActive : collectionToggle}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <span className="text-xs whitespace-nowrap text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                {selected.size} of {previewGames.length} selected
              </span>
              <ImportButton
                onClick={handleImportSelected}
                disabled={importing || selected.size === 0}
                label={importing ? 'Importing…' : `Import ${selected.size > 0 ? selected.size : ''}`}
              />
            </div>
          </div>
        </>
      )}
    </Dialog>
  )
}

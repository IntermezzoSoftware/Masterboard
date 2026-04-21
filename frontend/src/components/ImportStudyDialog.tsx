import { useState, useEffect } from 'react'
import { Dialog, DialogClose } from '@/components/Dialog'
import { Checkbox } from '@/components/Checkbox'
import { formInput, formLabel, btnPrimary, btnGhost, btnWhiteSide, btnBlackSide, collectionToggle, collectionToggleActive } from '@/lib/classNames'
import { api, type StudyMeta, type StudyChapterMeta, type Repertoire, type Folder, type LichessStudySummary } from '@/lib/api'
import { Select } from '@/components/Select'

interface Props {
  defaultDestination?: 'repertoire' | 'games'
  repertoires?: Repertoire[]
  folders?: Folder[]
  onImported: (result: Awaited<ReturnType<typeof api.importLichessStudy>>, repertoireId?: string) => void
  onClose: () => void
}

type Step = 'configure' | 'preview'
type StudyTab = 'studies' | 'url'

function parseStudyID(input: string): string {
  const match = input.match(/lichess\.org\/study\/([a-zA-Z0-9]{8})/)
  if (match) return match[1]
  if (/^[a-zA-Z0-9]{8}$/.test(input.trim())) return input.trim()
  return ''
}

function detectOrientation(chapters: StudyChapterMeta[]): 'white' | 'black' | 'mixed' {
  if (chapters.length === 0) return 'white'
  const first = chapters[0].orientation
  return chapters.every(c => c.orientation === first) ? (first as 'white' | 'black') : 'mixed'
}

export function ImportStudyDialog({ defaultDestination = 'repertoire', repertoires = [], folders = [], onImported, onClose }: Props) {
  const [step, setStep]                         = useState<Step>('configure')
  const [studyInput, setStudyInput]             = useState('')
  const [destination, setDestination]           = useState<'repertoire' | 'games'>(defaultDestination)
  const [meta, setMeta]                         = useState<StudyMeta | null>(null)
  const [selected, setSelected]                 = useState<Set<string>>(new Set())
  const [repName, setRepName]                   = useState('')
  const [colour, setColour]                     = useState<'white' | 'black'>('white')
  const [existingRepID, setExistingRepID]       = useState('')
  const [useExisting, setUseExisting]           = useState(false)
  const [targetFolderId, setTargetFolderId]     = useState('')
  const [loading, setLoading]                   = useState(false)
  const [importing, setImporting]               = useState(false)
  const [error, setError]                       = useState('')
  const [mixedOrientationWarning, setMixedOrientationWarning] = useState(false)

  // Repertoires fetched internally when destination === 'repertoire'
  const [fetchedRepertoires, setFetchedRepertoires] = useState<Repertoire[]>([])

  useEffect(() => {
    if (destination !== 'repertoire') return
    api.listRepertoires().then(setFetchedRepertoires).catch(() => {})
  }, [destination])

  // OAuth + studies list state
  const [oauthUsername, setOauthUsername]       = useState('')
  const [studyTab, setStudyTab]                 = useState<StudyTab>('url')
  const [studies, setStudies]                   = useState<LichessStudySummary[]>([])
  const [studiesLoading, setStudiesLoading]     = useState(false)
  const [studiesError, setStudiesError]         = useState('')

  useEffect(() => {
    api.lichessOAuthStatus().then(username => {
      if (username) {
        setOauthUsername(username)
        setStudyTab('studies')
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (studyTab !== 'studies' || !oauthUsername) return
    setStudiesLoading(true)
    setStudiesError('')
    api.listLichessStudies().then(setStudies).catch(e => {
      setStudiesError(e instanceof Error ? e.message : String(e))
    }).finally(() => setStudiesLoading(false))
  }, [studyTab, oauthUsername])

  const studyID = parseStudyID(studyInput)

  async function handlePreview(overrideID?: string) {
    const id = overrideID ?? studyID
    if (!id) {
      setError('Enter a valid Lichess study URL or 8-character ID.')
      return
    }
    if (overrideID) setStudyInput(overrideID)
    setLoading(true)
    setError('')
    try {
      const m = await api.fetchLichessStudyMeta(id)
      setMeta(m)
      setSelected(new Set(m.chapters.map(c => c.id)))
      setRepName(m.name)
      const orient = detectOrientation(m.chapters)
      if (orient === 'mixed') {
        setMixedOrientationWarning(true)
      } else {
        setColour(orient)
        setMixedOrientationWarning(false)
      }
      setStep('preview')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes('private')) {
        setError('This study is private. Connect your Lichess account in Settings → Connected Accounts to import it.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!meta) return
    setImporting(true)
    setError('')
    try {
      const result = await api.importLichessStudy({
        studyId: parseStudyID(studyInput),
        chapterIds: Array.from(selected),
        destination,
        repertoireId: useExisting ? existingRepID : '',
        repertoireName: repName,
        colour,
        folderId: destination === 'games' ? targetFolderId : '',
      })
      onImported(result, result.repertoireId || undefined)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  function toggleChapter(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (!meta) return
    if (selected.size === meta.chapters.length) setSelected(new Set())
    else setSelected(new Set(meta.chapters.map(c => c.id)))
  }

  const allRepertoires = repertoires.length > 0 ? repertoires : fetchedRepertoires
  const filteredReps = allRepertoires.filter(r => r.colour === colour)

  const allChecked  = !!meta && selected.size === meta.chapters.length
  const someChecked = selected.size > 0 && !!meta && selected.size < meta.chapters.length

  const importDisabled =
    importing ||
    selected.size === 0 ||
    (destination === 'repertoire' && !useExisting && !repName.trim()) ||
    (destination === 'repertoire' && useExisting && !existingRepID)

  const tabBtn = (active: boolean) => [
    'flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2',
    active
      ? 'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]'
      : 'border-transparent text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]',
  ].join(' ')

  const destinationPicker = (
    <div>
      <span className={formLabel}>Import destination</span>
      <div className="flex gap-2 mt-1">
        <button
          type="button"
          className={`flex-1 ${destination === 'repertoire' ? collectionToggleActive : collectionToggle}`}
          onClick={() => setDestination('repertoire')}
        >
          Import as Repertoire
        </button>
        <button
          type="button"
          className={`flex-1 ${destination === 'games' ? collectionToggleActive : collectionToggle}`}
          onClick={() => setDestination('games')}
        >
          Add to Games Library
        </button>
      </div>
    </div>
  )

  if (step === 'configure') {
    return (
      <Dialog onClose={onClose} title="Import Lichess Study" maxWidth="sm">
        {oauthUsername && (
          <div className="flex border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <button type="button" className={tabBtn(studyTab === 'studies')} onClick={() => { setStudyTab('studies'); setError('') }}>
              My Studies
            </button>
            <button type="button" className={tabBtn(studyTab === 'url')} onClick={() => { setStudyTab('url'); setError('') }}>
              By URL
            </button>
          </div>
        )}
        <div className="px-4 py-4 flex flex-col gap-3">
          {(!oauthUsername || studyTab === 'url') ? (
            <div>
              <label htmlFor="study-url-input" className={formLabel}>Study URL or ID</label>
              <input
                id="study-url-input"
                className={formInput}
                placeholder="https://lichess.org/study/XXXXXXXX"
                value={studyInput}
                onChange={e => setStudyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePreview()}
                autoFocus={!oauthUsername}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {studiesLoading && (
                <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] py-4 text-center">
                  Loading studies…
                </p>
              )}
              {studiesError && (
                <p className="text-xs text-red-600 dark:text-red-400">{studiesError}</p>
              )}
              {!studiesLoading && !studiesError && studies.length === 0 && (
                <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] py-4 text-center">
                  No studies found.
                </p>
              )}
              {!studiesLoading && studies.length > 0 && (
                <div className="flex flex-col max-h-52 overflow-y-auto -mx-1">
                  {studies.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={loading}
                      onClick={() => handlePreview(s.id)}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors disabled:opacity-50"
                    >
                      <span className="text-xs text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] truncate">
                        {s.name}
                      </span>
                      {s.chapters > 0 && (
                        <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] shrink-0">
                          {s.chapters} ch
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {destinationPicker}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
          <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
          {(!oauthUsername || studyTab === 'url') && (
            <button className={btnPrimary} onClick={() => handlePreview()} disabled={loading || !studyID}>
              {loading ? 'Loading…' : 'Preview'}
            </button>
          )}
          {oauthUsername && studyTab === 'studies' && loading && (
            <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] self-center">
              Loading…
            </span>
          )}
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog onClose={onClose} title={meta?.name ?? 'Import Lichess Study'} maxWidth="md">
      <div className="overflow-y-auto flex-1 px-4 py-4 flex flex-col gap-4">
        {destination === 'repertoire' && (
          <div className="flex flex-col gap-3">
            {mixedOrientationWarning && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Chapters have mixed orientations — choose which colour to import as.
              </p>
            )}
            <div className="flex items-center gap-3">
              <span className={`${formLabel} mb-0 w-24 shrink-0`}>Colour</span>
              <div className="flex gap-2">
                <button type="button" className={colour === 'white' ? btnWhiteSide : btnGhost} onClick={() => setColour('white')}>
                  White
                </button>
                <button type="button" className={colour === 'black' ? btnBlackSide : btnGhost} onClick={() => setColour('black')}>
                  Black
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`${formLabel} mb-0 w-24 shrink-0`}>Destination</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={!useExisting ? collectionToggleActive : collectionToggle}
                  onClick={() => setUseExisting(false)}
                >
                  New repertoire
                </button>
                {filteredReps.length > 0 && (
                  <button
                    type="button"
                    className={useExisting ? collectionToggleActive : collectionToggle}
                    onClick={() => setUseExisting(true)}
                  >
                    Add to existing
                  </button>
                )}
              </div>
            </div>
            {!useExisting ? (
              <div className="flex items-center gap-3">
                <label htmlFor="rep-name-input" className={`${formLabel} mb-0 w-24 shrink-0`}>Name</label>
                <input
                  id="rep-name-input"
                  className={`${formInput} flex-1`}
                  value={repName}
                  onChange={e => setRepName(e.target.value)}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <label htmlFor="rep-select" className={`${formLabel} mb-0 w-24 shrink-0`}>Repertoire</label>
                <select
                  id="rep-select"
                  className={`${formInput} flex-1`}
                  value={existingRepID}
                  onChange={e => setExistingRepID(e.target.value)}
                >
                  <option value="">Select…</option>
                  {filteredReps.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 pb-1.5 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <Checkbox
              checked={someChecked ? 'indeterminate' : allChecked}
              onCheckedChange={() => toggleAll()}
            />
            <span className="text-xs whitespace-nowrap text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
              {selected.size} of {meta?.chapters.length ?? 0} selected
            </span>
          </div>
          <div className="flex flex-col max-h-64 overflow-y-auto">
            {meta?.chapters.map((ch, i) => (
              <label
                key={ch.id}
                className="flex items-center gap-2 py-1 px-1 cursor-pointer rounded hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
              >
                <Checkbox checked={selected.has(ch.id)} onCheckedChange={() => toggleChapter(ch.id)} />
                <span className="text-xs font-mono text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] w-5 shrink-0 text-right">{i + 1}</span>
                <span className="text-xs flex-1 truncate text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{ch.name}</span>
                <span className={`text-xs px-1 py-0.5 rounded font-mono border ${
                  ch.orientation === 'white'
                    ? 'bg-[var(--color-surface-0)] dark:bg-[#e0e0e0] text-[#1a1a1a] border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]'
                    : 'bg-[#484848] dark:bg-[#333] text-white border-transparent'
                }`}>
                  {ch.orientation === 'white' ? 'W' : 'B'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
        <button className={btnGhost} onClick={() => { setStep('configure'); setError('') }}>← Back</button>
        <div className="flex items-center gap-3">
          {destination === 'games' && folders.length > 0 && (
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
          <button className={btnPrimary} disabled={importDisabled} onClick={handleImport}>
            {importing ? 'Importing…' : `Import ${selected.size} chapter${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

import { useState, useMemo } from 'react'
import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { btnPrimary, btnGhost, formInput, formLabel } from '@/lib/classNames'
import { api, type RepertoireMove, type WeightOverride } from '@/lib/api'

interface Props {
  repertoireId: string
  repertoireName: string
  moves: RepertoireMove[]
  onClose: () => void
}

function ExportBody({ repertoireId, repertoireName, moves }: Omit<Props, 'onClose'>) {
  const close = useDialogClose()
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const multiMoveFENs = useMemo(() => {
    const groups = new Map<string, RepertoireMove[]>()
    for (const m of moves) {
      const g = groups.get(m.fromFen) ?? []
      g.push(m)
      groups.set(m.fromFen, g)
    }
    return [...groups.values()]
      .filter(g => g.length > 1)
      .map(g => [...g].sort((a, b) => a.moveOrder - b.moveOrder))
  }, [moves])

  const [weights, setWeights] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>()
    for (const sibs of multiMoveFENs) {
      const n = sibs.length
      sibs.forEach((s, i) => m.set(s.id, Math.round(100 * (n - i) / n)))
    }
    return m
  })

  function setWeight(id: string, raw: string) {
    const v = Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
    setWeights(prev => new Map(prev).set(id, v))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const overrides: WeightOverride[] = []
      for (const sibs of multiMoveFENs) {
        for (const s of sibs) {
          const w = weights.get(s.id) ?? 50
          overrides.push({ fromFen: s.fromFen, moveUci: s.moveUci, weight: Math.round(w * 655) })
        }
      }
      const path = await api.exportRepertoireToPolyglot(repertoireId, overrides)
      if (path) {
        setResult(`Exported to: ${path}`)
      }
      // If path is empty, user cancelled the OS file dialog — leave dialog open, no result shown
    } catch (e) {
      setResult('Export failed: ' + String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="px-4 py-4 flex flex-col gap-4">
        <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          Exports your repertoire as a <code className="font-mono">.bin</code> opening book compatible with Arena, Cute Chess, BanksiaGUI, and Scid vs. PC.
        </p>

        {multiMoveFENs.length > 0 && (
          <div>
            <p className={formLabel}>
              Move weights (0–100) — positions with multiple candidate moves
            </p>
            <div className="max-h-56 overflow-y-auto flex flex-col gap-3 pr-1">
              {multiMoveFENs.map((sibs, gi) => (
                <div key={gi} className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] truncate leading-tight">
                    {sibs[0].fromFen}
                  </span>
                  <div className="flex flex-col gap-1 pl-2 border-l-2 border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
                    {sibs.map(s => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-xs font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                          {s.moveSan}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={weights.get(s.id) ?? 50}
                          onChange={e => setWeight(s.id, e.target.value)}
                          className={[formInput, 'w-20 text-center'].join(' ')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
          <p className={[
            'text-xs rounded-[var(--radius-sm)] px-2 py-1.5',
            result.startsWith('Export failed')
              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30'
              : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)]',
          ].join(' ')}>
            {result}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
        {result ? (
          <button onClick={() => close()} className={btnGhost}>Close</button>
        ) : (
          <>
            <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
            <button
              onClick={handleExport}
              disabled={exporting}
              className={btnPrimary}
            >
              {exporting ? 'Exporting…' : 'Export .bin'}
            </button>
          </>
        )}
      </div>
    </>
  )
}

export function ExportPolyglotDialog({ repertoireId, repertoireName, moves, onClose }: Props) {
  return (
    <Dialog
      onClose={onClose}
      title={`Export "${repertoireName}" to Polyglot`}
      maxWidth="sm"
    >
      <ExportBody repertoireId={repertoireId} repertoireName={repertoireName} moves={moves} />
    </Dialog>
  )
}

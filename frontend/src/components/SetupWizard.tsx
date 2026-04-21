import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CheckCircle2 } from 'lucide-react'
import { api, type EngineEntry } from '@/lib/api'
import { EngineDownloadList } from '@/components/EngineDownloadList'

type Step = 'welcome' | 'engine' | 'masterdb' | 'done'

export default function SetupWizard() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState<Step>('welcome')
  const [installedEngines, setInstalledEngines] = useState<EngineEntry[]>([])
  const hadEngineRef = useRef(false)

  useEffect(() => {
    Promise.all([api.isSetupComplete(), api.getEngineState()])
      .then(([complete, state]) => {
        if (!complete) {
          hadEngineRef.current = state.availableEngines.length > 0
          setInstalledEngines(state.availableEngines)
          setVisible(true)
        }
      })
      .catch(() => {})
  }, [])

  function finish() {
    api.markSetupComplete().catch(() => {})
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="First-run setup"
    >
      <div className="w-[520px] max-w-[90vw] rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-3">
          <h2 className="text-lg font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            {step === 'welcome'   && 'Welcome to Masterboard'}
            {step === 'engine'   && 'Install a chess engine'}
            {step === 'masterdb' && 'Opening database'}
            {step === 'done'     && "You're all set"}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 pb-3 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          {step === 'welcome' && (
            <p>
              {hadEngineRef.current
                ? 'Masterboard is ready to use. Continue to review optional setup, or skip straight to the app.'
                : 'Masterboard needs a chess engine to analyse games and show real-time evaluation. Install one on the next step — it only takes a minute.'}
            </p>
          )}
          {step === 'engine' && (
            <div className="flex flex-col gap-4">
              <p>
                A chess engine powers real-time evaluation, the eval bar, and game analysis.
                Download one below — it only takes a moment.
              </p>
              <EngineDownloadList
                availableEngines={installedEngines}
                onInstalled={() => api.getEngineState().then(s => setInstalledEngines(s.availableEngines)).catch(() => {})}
              />
            </div>
          )}
          {step === 'masterdb' && (
            <p>
              Masterboard can show opening statistics — move popularity, win rates, and top
              games — powered by a local database you import once. This is optional and can
              be set up any time in <strong>Settings → Master Database</strong>.
            </p>
          )}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-2">
              <CheckCircle2 size={40} className="text-[var(--color-accent)]" aria-hidden="true" />
              <p className="text-center">
                Masterboard is ready. Engine settings can be adjusted at any time in{' '}
                <strong>Settings → Engines</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-[var(--color-surface-2)] dark:border-[var(--color-dark-surface-2)]">
          <div className="flex gap-1.5">
            {(['welcome', 'engine', 'masterdb', 'done'] as Step[]).map(s => (
              <div
                key={s}
                className={`h-1.5 w-4 rounded-full transition-colors ${
                  s === step
                    ? 'bg-[var(--color-accent)]'
                    : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {step !== 'done' && (
              <button
                onClick={finish}
                className="px-3 py-1.5 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
              >
                Skip
              </button>
            )}
            {step === 'welcome' && (
              <button
                onClick={() => setStep('engine')}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
              >
                Next <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
            {step === 'engine' && (
              <button
                onClick={() => setStep('masterdb')}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
              >
                Next <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
            {step === 'masterdb' && (
              <button
                onClick={() => setStep('done')}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
              >
                Next <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
            {step === 'done' && (
              <button
                onClick={finish}
                className="px-4 py-1.5 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
              >
                Get started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

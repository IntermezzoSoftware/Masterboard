import { Dialog } from '@/components/Dialog'
import { EngineDownloadList } from '@/components/EngineDownloadList'
import type { EngineEntry } from '@/lib/api'

interface Props {
  onClose: () => void
  availableEngines: EngineEntry[]
}

export function EngineDownloadDialog({ onClose, availableEngines }: Props) {
  return (
    <Dialog onClose={onClose} title="Download Engine" maxWidth="md">
      <div className="px-4 py-4">
        <EngineDownloadList availableEngines={availableEngines} />
      </div>
    </Dialog>
  )
}

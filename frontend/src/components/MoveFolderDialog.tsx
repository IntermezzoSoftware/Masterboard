import { useState } from 'react'
import { Folder, ChevronRight } from 'lucide-react'
import { Dialog, DialogClose, useDialogClose } from '@/components/Dialog'
import { btnPrimary, btnGhost } from '@/lib/classNames'
import type { Folder as FolderType } from '@/lib/api'

interface FolderNode extends FolderType {
  children: FolderNode[]
}

function buildTree(folders: FolderType[]): FolderNode[] {
  const map = new Map<string, FolderNode>()
  const roots: FolderNode[] = []
  for (const f of folders) {
    map.set(f.id, { ...f, children: [] })
  }
  for (const f of folders) {
    const node = map.get(f.id)!
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function FolderOption({
  node,
  depth,
  selectedId,
  expanded,
  onSelect,
  onToggle,
}: {
  node: FolderNode
  depth: number
  selectedId: string | null
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  const isSelected = selectedId === node.id
  const isExpanded = expanded.has(node.id)

  return (
    <>
      <div
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={[
          'flex items-center gap-1.5 py-1 pr-2 cursor-pointer rounded-[var(--radius-sm)] text-xs',
          isSelected
            ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
            : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
        ].join(' ')}
        onClick={() => onSelect(node.id)}
      >
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0"
          onClick={e => { e.stopPropagation(); onToggle(node.id) }}
        >
          {node.children.length > 0 && (
            <ChevronRight size={10} className={isExpanded ? 'rotate-90 transition-transform' : 'transition-transform'} />
          )}
        </button>
        <Folder size={12} className="shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded && node.children.map(child => (
        <FolderOption
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

function MoveFolderFooter({ selectedId, onMove }: { selectedId: string | null; onMove: (folderId: string | null) => void }) {
  const close = useDialogClose()
  return (
    <div className="flex justify-between gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
      <button
        onClick={() => { onMove(null); close() }}
        className={btnGhost}
      >
        Remove from folder
      </button>
      <div className="flex gap-2">
        <DialogClose asChild><button className={btnGhost}>Cancel</button></DialogClose>
        <button
          onClick={() => { if (selectedId) { onMove(selectedId); close() } }}
          disabled={!selectedId}
          className={[btnPrimary, !selectedId ? 'opacity-50 cursor-not-allowed' : ''].join(' ')}
        >
          Move here
        </button>
      </div>
    </div>
  )
}

interface MoveFolderDialogProps {
  gameCount: number
  folders: FolderType[]
  currentFolderId?: string | null
  onMove: (folderId: string | null) => void
  onClose: () => void
}

export default function MoveFolderDialog({
  gameCount, folders, currentFolderId, onMove, onClose,
}: MoveFolderDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const roots = buildTree(folders)

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const title = gameCount === 1 ? 'Move game to folder' : `Move ${gameCount} games to folder`

  return (
    <Dialog title={title} onClose={onClose} maxWidth="sm">
      <div className="px-4 py-3 max-h-72 overflow-y-auto">
        {roots.length === 0 ? (
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] text-center py-4">
            No folders yet. Create folders from the Games sidebar.
          </p>
        ) : (
          roots.map(node => (
            <FolderOption
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={setSelectedId}
              onToggle={toggleExpand}
            />
          ))
        )}
      </div>
      <MoveFolderFooter selectedId={selectedId} onMove={onMove} />
    </Dialog>
  )
}

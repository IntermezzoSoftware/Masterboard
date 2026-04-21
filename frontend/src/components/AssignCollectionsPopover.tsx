import { useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Plus, Tag, X } from 'lucide-react'
import { api, type Collection } from '@/lib/api'
import { collectionToggle, collectionToggleActive, btnDanger, btnGhost } from '@/lib/classNames'
import { Dialog } from '@/components/Dialog'

interface AssignCollectionsPopoverProps {
  gameId: string
  onChanged: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AssignCollectionsPopover({
  gameId,
  onChanged,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AssignCollectionsPopoverProps) {
  const isControlled = controlledOpen !== undefined
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [allCollections, setAllCollections] = useState<Collection[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Collection | null>(null)
  // Ref mirrors confirmDelete so handleOpenChange can read it synchronously
  // before React has committed the state update.
  const confirmDeleteRef = useRef<Collection | null>(null)
  const dirty = useRef(false)

  function handleOpenChange(open: boolean) {
    // Suppress Popover close while the confirm dialog is stealing focus.
    if (!open && confirmDeleteRef.current !== null) return
    if (open) {
      dirty.current = false
      setError('')
      load()
    } else {
      if (dirty.current) onChanged()
    }
    if (isControlled) {
      controlledOnOpenChange?.(open)
    } else {
      setPopoverOpen(open)
    }
  }

  async function load() {
    try {
      const [cols, gameCols] = await Promise.all([
        api.listCollections(),
        api.listGameCollections(gameId),
      ])
      setAllCollections(cols ?? [])
      setAssigned(new Set((gameCols ?? []).map(c => c.id)))
    } catch {
      setError('Failed to load collections')
    }
  }

  async function toggle(coll: Collection) {
    const isAssigned = assigned.has(coll.id)
    const next = new Set(assigned)
    try {
      if (isAssigned) {
        await api.removeGameFromCollection(gameId, coll.id)
        next.delete(coll.id)
      } else {
        await api.addGameToCollection(gameId, coll.id)
        next.add(coll.id)
      }
      setAssigned(next)
      dirty.current = true
    } catch {
      setError('Failed to update collection')
    }
  }

  function handleDelete(coll: Collection) {
    confirmDeleteRef.current = coll
    setConfirmDelete(coll)
  }

  function cancelDelete() {
    confirmDeleteRef.current = null
    setConfirmDelete(null)
  }

  async function confirmDeleteCollection() {
    const coll = confirmDeleteRef.current
    if (!coll) return
    confirmDeleteRef.current = null
    setConfirmDelete(null)
    try {
      await api.deleteCollection(coll.id)
      setAllCollections(prev => prev.filter(c => c.id !== coll.id))
      setAssigned(prev => { const next = new Set(prev); next.delete(coll.id); return next })
      dirty.current = true
    } catch {
      setError(`Failed to delete "${coll.name}"`)
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError('')
    try {
      const id = await api.createCollection(name)
      const newColl: Collection = { id, name, description: '' }
      setAllCollections(prev => [...prev, newColl].sort((a, b) => a.name.localeCompare(b.name)))
      await api.addGameToCollection(gameId, id)
      setAssigned(prev => new Set([...prev, id]))
      setNewName('')
      dirty.current = true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create collection')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Popover.Root open={isControlled ? controlledOpen : popoverOpen} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            onClick={e => e.stopPropagation()}
            className={`${isControlled ? 'invisible' : 'opacity-0 group-hover:opacity-100'} p-1 rounded text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-accent)] dark:hover:text-[var(--color-dark-accent)] transition-all`}
            title="Manage collections"
            aria-label="Manage collections"
          >
            <Tag size={11} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            onOpenAutoFocus={e => e.preventDefault()}
            aria-label="Assign collections"
            className="z-30 w-56 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-lg p-2"
            onClick={e => e.stopPropagation()}
          >
            {error && (
              <p className="pb-1 text-xs text-red-600 dark:text-red-400">{error}</p>
            )}

            {allCollections.length === 0 && !error ? (
              <p className="pb-1.5 text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                No collections yet
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {allCollections.map(coll => {
                  const active = assigned.has(coll.id)
                  return (
                    <div key={coll.id} className={`group/pill flex items-center gap-1 ${active ? collectionToggleActive : collectionToggle}`}>
                      <button type="button" onClick={() => toggle(coll)}>
                        {coll.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(coll)}
                        className="opacity-0 group-hover/pill:opacity-100 transition-opacity"
                        title={`Delete collection "${coll.name}"`}
                        aria-label={`Delete collection ${coll.name}`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="border-t border-[var(--color-surface-2)] dark:border-[var(--color-dark-surface-2)] pt-2 flex items-center gap-1">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder="New collection…"
                aria-label="New collection name"
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="p-1 rounded-[var(--radius-sm)] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] dark:hover:bg-[var(--color-dark-accent-subtle)] transition-colors disabled:opacity-40"
                aria-label="Create collection"
              >
                <Plus size={13} />
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {confirmDelete && (
        <Dialog title="Delete collection?" maxWidth="xs" onClose={cancelDelete}>
          <div className="px-4 py-4 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            Delete <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{confirmDelete.name}</span>? It will be removed from all games.
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <button onClick={cancelDelete} className={btnGhost}>Cancel</button>
            <button onClick={confirmDeleteCollection} className={btnDanger}>Delete</button>
          </div>
        </Dialog>
      )}
    </>
  )
}

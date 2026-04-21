import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { Tree, type CreateHandler, type NodeApi, type NodeRendererProps, type RenameHandler, type TreeApi } from 'react-arborist'
import type { Folder as FolderType } from '@/lib/api'
import { menuContent, menuItemNormal, menuItemDestructive } from '@/lib/classNames'

export type FolderSelection =
  | { type: 'all' }
  | { type: 'unfiled' }
  | { type: 'folder'; id: string }

interface ArboristFolder {
  id: string
  name: string
  children?: ArboristFolder[]
}

interface FolderTreeProps {
  folders: FolderType[]
  selection: FolderSelection
  onSelect: (s: FolderSelection) => void
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>
  onRenameFolder: (id: string, name: string) => Promise<void>
  onDeleteFolder: (id: string) => void
  initialOpenState?: Record<string, boolean>
  onOpenStateChange?: (state: Record<string, boolean>) => void
}

interface TreeCtxValue {
  selection: FolderSelection
  onDeleteFolder: (id: string) => void
  onHeightUpdate: () => void
  onCancelCreate: () => void
}

const ROW_HEIGHT = 24
const INDENT = 12
const NEW_ID = '__new__'


const TreeCtx = createContext<TreeCtxValue>({
  selection: { type: 'all' },
  onDeleteFolder: () => {},
  onHeightUpdate: () => {},
  onCancelCreate: () => {},
})

function buildTree(flat: FolderType[]): ArboristFolder[] {
  const map = new Map<string, ArboristFolder>()
  const roots: ArboristFolder[] = []
  for (const f of flat) map.set(f.id, { id: f.id, name: f.name })
  for (const f of flat) {
    const node = map.get(f.id)!
    if (f.parentId && map.has(f.parentId)) {
      const parent = map.get(f.parentId)!
      if (!parent.children) parent.children = []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/**
 * Insert a temporary "new folder" placeholder node into the tree.
 * `creatingParentId` is null for root, or the parent folder's id.
 */
function insertTempNode(tree: ArboristFolder[], creatingParentId: string | null): ArboristFolder[] {
  const tempNode: ArboristFolder = { id: NEW_ID, name: '' }
  if (creatingParentId === null) {
    return [...tree, tempNode]
  }
  function insert(nodes: ArboristFolder[]): ArboristFolder[] {
    return nodes.map(n => {
      if (n.id === creatingParentId) {
        return { ...n, children: [...(n.children ?? []), tempNode] }
      }
      if (n.children) return { ...n, children: insert(n.children) }
      return n
    })
  }
  return insert(tree)
}

function FolderNode({ node, style, dragHandle }: NodeRendererProps<ArboristFolder>) {
  const { selection, onDeleteFolder, onHeightUpdate, onCancelCreate } = useContext(TreeCtx)
  const inputRef = useRef<HTMLInputElement>(null)
  const committed = useRef(false)
  const isSelected = selection.type === 'folder' && selection.id === node.id

  // Reset commit guard when edit mode changes
  useEffect(() => { committed.current = false }, [node.isEditing])

  // Auto-focus the inline input. requestAnimationFrame fires after all
  // pending setTimeout(0) callbacks (including Radix FocusScope's focus-return
  // cleanup) and after React has committed DOM updates, so the input is stable
  // and in its final position before we try to focus it.
  useEffect(() => {
    if (!node.isEditing) return
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
    return () => cancelAnimationFrame(id)
  }, [node.isEditing])

  function commitEdit(value: string) {
    if (committed.current) return
    committed.current = true
    node.submit(value)
  }

  function cancelEdit() {
    if (committed.current) return
    committed.current = true
    // If cancelling a new-folder creation, clear the pending state in FolderTree
    if (node.id === NEW_ID) onCancelCreate()
    node.reset()
  }

  return (
    <ContextMenu.Root>
      {/*
        arborist's DefaultRow container (rendered above this) handles:
        - absolute positioning (position, top, height, left, right)
        - role="treeitem", aria-level, aria-selected, aria-expanded
        - onClick={node.handleClick} for selection

        `style` here is only { paddingLeft: level * indent } for indentation.
        We apply it to our content div so the folder is correctly indented.
      */}
      <ContextMenu.Trigger asChild>
        <div
          style={style}
          ref={dragHandle}
          className={[
            'flex items-center gap-1 h-full pr-2 cursor-pointer rounded-[var(--radius-sm)] select-none outline-none',
            isSelected
              ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
              : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
          ].join(' ')}
          onClick={() => {
            // Selection is handled by DefaultRow's onClick={node.handleClick}.
            // We only need to handle expand/collapse here.
            if (!node.isEditing && !node.isLeaf) {
              node.toggle()
              onHeightUpdate()
            }
          }}
        >
          {/* Chevron — always reserves space so leaf nodes align with parent nodes */}
          <span className="shrink-0 w-2.5 flex items-center justify-center">
            {!node.isLeaf && (
              <button
                className="flex items-center justify-center"
                onClick={e => {
                  e.stopPropagation() // prevent double-toggle from bubbling to row onClick
                  node.toggle()
                  onHeightUpdate()
                }}
              >
                <ChevronRight
                  size={10}
                  className={node.isOpen ? 'rotate-90 transition-transform' : 'transition-transform'}
                />
              </button>
            )}
          </span>

          {/* Folder icon */}
          {node.isOpen
            ? <FolderOpen size={12} className="shrink-0" />
            : <Folder size={12} className="shrink-0" />
          }

          {/* Name or inline edit input */}
          {node.isEditing ? (
            <input
              ref={inputRef}
              data-testid="folder-edit-input"
              defaultValue={node.id === NEW_ID ? '' : (node.data.name ?? '')}
              className="flex-1 min-w-0 text-xs px-1 py-0 rounded border border-[var(--color-accent)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] focus:outline-none"
              onBlur={e => commitEdit(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.currentTarget.value) }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="truncate text-xs">{node.data.name}</span>
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent}>
          <ContextMenu.Item
            className={menuItemNormal}
            onSelect={() => {
              window.setTimeout(() => {
                if (!node.isOpen) { node.open(); onHeightUpdate() }
                node.tree.create({ parentId: node.id })
              }, 0)
            }}
          >
            New subfolder
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItemNormal}
            onSelect={() => { window.setTimeout(() => node.edit(), 0) }}
          >
            Rename
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItemDestructive} onSelect={() => onDeleteFolder(node.id)}>
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export default function FolderTree({
  folders, selection, onSelect,
  onCreateFolder, onRenameFolder, onDeleteFolder,
  initialOpenState, onOpenStateChange,
}: FolderTreeProps) {
  const treeRef = useRef<TreeApi<ArboristFolder> | undefined>(undefined)

  // `creatingParentId` tracks an in-progress inline creation:
  //   false       → no creation in progress
  //   null        → creating at root level
  //   string      → creating as child of that folder id
  //
  // When set, a temp node (id = '__new__') is spliced into the data passed to
  // arborist so arborist can find and edit it. flushSync in handleCreate ensures
  // the state commits (and the temp node appears) before arborist calls edit().
  const [creatingParentId, setCreatingParentId] = useState<string | null | false>(false)

  const data = useMemo(() => {
    const tree = buildTree(folders)
    return creatingParentId === false ? tree : insertTempNode(tree, creatingParentId)
  }, [folders, creatingParentId])

  // Initial height: only root nodes visible (openByDefault=false)
  const [treeHeight, setTreeHeight] = useState(() => data.length * ROW_HEIGHT)

  function updateHeight() {
    requestAnimationFrame(() => {
      if (treeRef.current) {
        setTreeHeight(treeRef.current.visibleNodes.length * ROW_HEIGHT)
        if (onOpenStateChange) {
          const state: Record<string, boolean> = {}
          for (const folder of folders) {
            if (treeRef.current.get(folder.id)?.isOpen) state[folder.id] = true
          }
          onOpenStateChange(state)
        }
      }
    })
  }

  // Recompute height when the folder data changes (add/remove/rename)
  useEffect(() => { updateHeight() }, [data])

  const selectedId = selection.type === 'folder' ? selection.id : undefined

  const handleRename: RenameHandler<ArboristFolder> = ({ id, name, node }) => {
    // Always clear any pending creation, whether submitted or blurred with empty input
    setCreatingParentId(false)
    const trimmed = name.trim()
    if (!trimmed) return
    if (id === NEW_ID) {
      // Inline create — determine parent from the node's position in the tree
      const parentId = node.parent && !node.parent.isRoot ? node.parent.id : null
      onCreateFolder(trimmed, parentId).catch(() => {})
    } else {
      onRenameFolder(id, trimmed).catch(() => {})
    }
  }

  // arborist v3 calls onCreate first, then (in a setTimeout) dispatches edit()
  // on the returned node. The node must exist in our data prop by that point.
  // flushSync forces a synchronous commit so the temp node is in the DOM before
  // arborist calls edit().
  const handleCreate: CreateHandler<ArboristFolder> = ({ parentId }) => {
    const tempNode: ArboristFolder = { id: NEW_ID, name: '' }
    flushSync(() => setCreatingParentId(parentId ?? null))
    return tempNode
  }

  const ctxValue: TreeCtxValue = {
    selection,
    onDeleteFolder,
    onHeightUpdate: updateHeight,
    onCancelCreate: () => setCreatingParentId(false),
  }

  const baseRowClass = 'flex items-center gap-1.5 px-2 py-0.5 text-xs cursor-pointer rounded-[var(--radius-sm)] select-none'

  function selClass(type: FolderSelection['type']) {
    const active = selection.type === type
    return active
      ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
      : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'
  }

  return (
    <TreeCtx.Provider value={ctxValue}>
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 shrink-0 bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <span className="text-xs font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            Folders
          </span>
          <button
            onClick={() => treeRef.current?.create({ parentId: null })}
            title="New folder"
            className="p-1 rounded-[var(--radius-sm)] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
          >
            <FolderPlus size={12} />
          </button>
        </div>

        {/* Special entries */}
        <div className={`${baseRowClass} ${selClass('all')}`} onClick={() => onSelect({ type: 'all' })}>
          All Games
        </div>
        <div className={`${baseRowClass} ${selClass('unfiled')}`} onClick={() => onSelect({ type: 'unfiled' })}>
          Unfiled
        </div>

        {/* Divider */}
        <div className="mx-2 my-1 h-px bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]" />

        {/* Folder tree — height managed dynamically to match visible node count */}
        <Tree
          ref={treeRef}
          data={data}
          rowClassName="outline-none"
          selection={selectedId}
          onSelect={(nodes: NodeApi<ArboristFolder>[]) => {
            if (nodes.length > 0) onSelect({ type: 'folder', id: nodes[0].id })
          }}
          onRename={handleRename}
          onCreate={handleCreate}
          onToggle={updateHeight}
          height={treeHeight}
          rowHeight={ROW_HEIGHT}
          indent={INDENT}
          openByDefault={false}
          initialOpenState={initialOpenState}
          disableMultiSelection
          disableDrag
          disableDrop
          width="100%"
        >
          {FolderNode}
        </Tree>
      </div>
    </TreeCtx.Provider>
  )
}

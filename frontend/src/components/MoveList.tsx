import { useEffect, useRef, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import type { GameNode } from '@/hooks/useChessGame'
import type { Repertoire } from '@/lib/api'
import { menuContent, menuItemNormal, menuItemDestructive, menuItemActive, menuSeparator } from '@/lib/classNames'

export interface MoveListProps {
  rootNode: GameNode
  currentNodeId: string
  onGoToNode: (node: GameNode) => void
  onDeleteFrom: (node: GameNode) => void
  onPromoteVariation: (node: GameNode) => void
  onSetNodeNag: (node: GameNode, nag: number | undefined) => void
  onSetNodeComment: (node: GameNode, comment: string) => void
  result?: string
  repertoires?: Repertoire[]
  onAddToRepertoire?: (node: GameNode, repertoireId: string) => void
  deviationFen?: string
  deviationMove?: string
}

// Parse side-to-move from parent FEN (the position *before* the move was played)
function moveSide(node: GameNode): 'white' | 'black' {
  return node.parent!.fen.split(' ')[1] === 'w' ? 'white' : 'black'
}

function moveNumber(node: GameNode): number {
  return parseInt(node.parent!.fen.split(' ')[5] ?? '1', 10)
}

const NAG_SYMBOL: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!',
}


const NAG_OPTIONS = [
  { nag: 1, symbol: '!',  label: 'Good move'   },
  { nag: 2, symbol: '?',  label: 'Mistake'     },
  { nag: 3, symbol: '!!', label: 'Brilliant'   },
  { nag: 4, symbol: '??', label: 'Blunder'     },
  { nag: 5, symbol: '!?', label: 'Interesting' },
  { nag: 6, symbol: '?!', label: 'Dubious'     },
]


function CommentEditor({
  initialText,
  onSave,
  onCancel,
  inline = false,
}: {
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
  inline?: boolean
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const [text, setText] = useState(initialText)

  useEffect(() => {
    // Delay focus so it fires after FocusScope's cleanup timer (setTimeout 0) runs
    // and removes the focusin trap that would otherwise steal focus back.
    const id = window.setTimeout(() => { ref.current?.focus() }, 0)
    return () => window.clearTimeout(id)
  }, [])

  const sharedProps = {
    ref,
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => onSave(text),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(text) }
    },
    'aria-label': 'Move comment',
    placeholder: 'Add a comment…',
  }

  const inputClasses = [
    'text-xs font-sans resize-none rounded-[var(--radius-sm)] px-2 py-0.5',
    'border border-[var(--color-accent)] dark:border-[var(--color-dark-accent)]',
    'bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)]',
    'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]',
    'focus:outline-none',
  ].join(' ')

  if (inline) {
    return (
      <input
        {...sharedProps}
        ref={ref as React.RefObject<HTMLInputElement>}
        type="text"
        className={`${inputClasses} inline w-24 mx-0.5`}
      />
    )
  }

  return (
    <div className="block w-full px-1 pb-1.5">
      <textarea
        {...sharedProps}
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        rows={2}
        className={`w-full ${inputClasses}`}
      />
    </div>
  )
}

interface MoveSequenceProps {
  startNode: GameNode
  currentNodeId: string
  onGoToNode: (node: GameNode) => void
  onDeleteFrom: (node: GameNode) => void
  onPromoteVariation: (node: GameNode) => void
  onSetNodeNag: (node: GameNode, nag: number | undefined) => void
  onSetNodeComment: (node: GameNode, comment: string) => void
  editingNodeId: string | null
  onStartEdit: (nodeId: string, currentText: string) => void
  onFinishEdit: (node: GameNode, text: string) => void
  onCancelEdit: () => void
  forceShowNumber: boolean
  isVariation?: boolean
  activeRef: React.RefObject<HTMLButtonElement | null>
  repertoires?: Repertoire[]
  onAddToRepertoire?: (node: GameNode, repertoireId: string) => void
  deviationFen?: string
  deviationMove?: string
}

// Variations are siblings of the current mainline node (parent.children[1..n]).
// They appear after the mainline move and before the mainline continuation.
function MoveSequence({
  startNode, currentNodeId, onGoToNode, onDeleteFrom, onPromoteVariation,
  onSetNodeNag, onSetNodeComment,
  editingNodeId, onStartEdit, onFinishEdit, onCancelEdit,
  forceShowNumber, isVariation = false, activeRef,
  repertoires, onAddToRepertoire,
  deviationFen, deviationMove,
}: MoveSequenceProps) {
  const pendingCommentFocus = useRef(false)
  const elements: React.ReactNode[] = []
  let node: GameNode | null = startNode
  let isFirst = true
  let forceNextNumber = false

  const inactiveMove = isVariation
    ? 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] italic hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer'
    : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer'

  const numClass = isVariation
    ? 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] select-none'
    : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium select-none'

  while (node !== null) {
    const side = moveSide(node)
    const num = moveNumber(node)
    const isCurrent = node.id === currentNodeId
    const showNum = forceNextNumber || (isFirst ? forceShowNumber || side === 'white' : side === 'white')
    forceNextNumber = false
    isFirst = false

    if (showNum) {
      elements.push(
        <span key={`${node.id}-num`} className={numClass}>
          {num}{side === 'black' ? '...' : '.'}
          {' '}
        </span>,
      )
    }

    const capturedNode = node

    // Build context menu for this move
    const nagItems = NAG_OPTIONS.map(({ nag, symbol, label }) => (
      <ContextMenu.Item
        key={nag}
        className={capturedNode.nag === nag ? menuItemActive : menuItemNormal}
        onSelect={() => onSetNodeNag(capturedNode, capturedNode.nag === nag ? undefined : nag)}
      >
        <span className="inline-block w-5 font-mono">{symbol}</span>
        {label}
      </ContextMenu.Item>
    ))

    const commentItems = [
      <ContextMenu.Item
        key="edit-comment"
        className={menuItemNormal}
        onPointerDown={() => { pendingCommentFocus.current = true }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') pendingCommentFocus.current = true }}
        onSelect={() => onStartEdit(capturedNode.id, capturedNode.comment ?? '')}
      >
        {capturedNode.comment ? 'Edit comment' : 'Add comment'}
      </ContextMenu.Item>,
      capturedNode.comment ? (
        <ContextMenu.Item
          key="clear-comment"
          className={menuItemNormal}
          onSelect={() => onSetNodeComment(capturedNode, '')}
        >
          Clear comment
        </ContextMenu.Item>
      ) : null,
    ].filter(Boolean)

    const isMainlineMove = capturedNode.parent ? capturedNode.parent.children[0] === capturedNode : false

    elements.push(
      <ContextMenu.Root key={node.id}>
        <ContextMenu.Trigger asChild>
          <button
            ref={isCurrent ? activeRef : undefined}
            onClick={e => { onGoToNode(capturedNode); e.currentTarget.blur() }}
            className={[
              'px-1 py-0.5 rounded-[var(--radius-sm)] transition-colors mr-0.5',
              isVariation ? 'text-xs' : '',
              isCurrent
                ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
                : inactiveMove,
            ].join(' ')}
          >
            {capturedNode.san}
            {capturedNode.nag !== undefined && (
              <span className="ml-0.5 font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                {NAG_SYMBOL[capturedNode.nag] ?? `$${capturedNode.nag}`}
              </span>
            )}
            {deviationFen && deviationMove &&
              capturedNode.parent?.fen === deviationFen &&
              capturedNode.san === deviationMove && (
              <span
                className="ml-1 inline-block w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500 shrink-0"
                title="Off-book — left prepared opening"
              />
            )}
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className={menuContent}
            onCloseAutoFocus={e => {
              if (pendingCommentFocus.current) {
                e.preventDefault()
                pendingCommentFocus.current = false
              }
            }}
          >
            {nagItems}
            <div className={menuSeparator} />
            {commentItems}
            <div className={menuSeparator} />
            {repertoires && repertoires.length > 0 && onAddToRepertoire && (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger
                  className={[
                    menuItemNormal,
                    'flex items-center justify-between',
                    'data-[state=open]:bg-[var(--color-surface-2)] dark:data-[state=open]:bg-[var(--color-dark-surface-2)]',
                  ].join(' ')}
                >
                  Add to repertoire
                  <span className="ml-3 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] select-none">›</span>
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={menuContent}>
                    {repertoires.map(r => (
                      <ContextMenu.Item
                        key={r.id}
                        className={menuItemNormal}
                        onSelect={() => onAddToRepertoire(capturedNode, r.id)}
                      >
                        <span className="flex items-center gap-2">
                          <span className={[
                            'shrink-0 inline-block w-2 h-2 rounded-full border border-gray-400 dark:border-gray-500',
                            r.colour === 'white' ? 'bg-white' : 'bg-neutral-900',
                          ].join(' ')} />
                          {r.name}
                        </span>
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            )}
            {isVariation && (
              <ContextMenu.Item
                className={menuItemNormal}
                onSelect={() => onPromoteVariation(capturedNode)}
              >
                Promote to main line
              </ContextMenu.Item>
            )}
            <ContextMenu.Item
              className={menuItemDestructive}
              onSelect={() => onDeleteFrom(capturedNode)}
            >
              Delete from here
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    )

    // Comment display / inline editor
    if (editingNodeId === capturedNode.id) {
      elements.push(
        <CommentEditor
          key={`${capturedNode.id}-comment-editor`}
          initialText={capturedNode.comment ?? ''}
          onSave={text => onFinishEdit(capturedNode, text)}
          onCancel={onCancelEdit}
          inline={isVariation}
        />,
      )
    } else if (capturedNode.comment) {
      elements.push(
        isVariation ? (
          <span
            key={`${capturedNode.id}-comment`}
            className="px-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]"
          >
            {capturedNode.comment}
          </span>
        ) : (
          <div
            key={`${capturedNode.id}-comment`}
            className="block w-full px-1 pb-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] leading-relaxed"
          >
            {capturedNode.comment}
          </div>
        ),
      )
    }

    // Render sibling variations (parent.children[1..n]), only for mainline nodes
    const siblingVariations = isMainlineMove && capturedNode.parent!.children.length > 1
      ? capturedNode.parent!.children.slice(1)
      : []

    for (const varChild of siblingVariations) {
      const capturedVar = varChild
      elements.push(
        <span
          key={`var-wrap-${varChild.id}`}
          className="inline-block rounded-[var(--radius-sm)] px-1 mx-0.5 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]"
        >
          <span className="select-none">{'( '}</span>
          <MoveSequence
            startNode={varChild}
            currentNodeId={currentNodeId}
            onGoToNode={onGoToNode}
            onDeleteFrom={onDeleteFrom}
            onPromoteVariation={onPromoteVariation}
            onSetNodeNag={onSetNodeNag}
            onSetNodeComment={onSetNodeComment}
            editingNodeId={editingNodeId}
            onStartEdit={onStartEdit}
            onFinishEdit={onFinishEdit}
            onCancelEdit={onCancelEdit}
            forceShowNumber={true}
            isVariation={true}
            activeRef={activeRef}
            repertoires={repertoires}
            onAddToRepertoire={onAddToRepertoire}
            deviationFen={deviationFen}
            deviationMove={deviationMove}
          />
          <span className="select-none">{' )'}</span>
          {/* Variation-level context menu removed — individual moves have their own menus */}
        </span>,
      )
    }

    if (siblingVariations.length > 0 && side === 'white') forceNextNumber = true
    node = node.children[0] ?? null
  }

  return <>{elements}</>
}

export default function MoveList({
  rootNode, currentNodeId,
  onGoToNode, onDeleteFrom, onPromoteVariation,
  onSetNodeNag, onSetNodeComment, result,
  repertoires, onAddToRepertoire,
  deviationFen, deviationMove,
}: MoveListProps) {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (currentNodeId === rootNode.id) {
      containerRef.current?.scrollTo({ top: 0 })
    } else {
      activeRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [currentNodeId, rootNode.id])

  function handleStartEdit(nodeId: string, _currentText: string) {
    setEditingNodeId(nodeId)
  }

  function handleFinishEdit(node: GameNode, text: string) {
    onSetNodeComment(node, text)
    setEditingNodeId(null)
  }

  function handleCancelEdit() {
    setEditingNodeId(null)
  }

  if (rootNode.children.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-3 text-center text-14 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
        No moves yet.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-3 font-mono text-14 leading-relaxed">
      <MoveSequence
        startNode={rootNode.children[0]}
        currentNodeId={currentNodeId}
        onGoToNode={onGoToNode}
        onDeleteFrom={onDeleteFrom}
        onPromoteVariation={onPromoteVariation}
        onSetNodeNag={onSetNodeNag}
        onSetNodeComment={onSetNodeComment}
        editingNodeId={editingNodeId}
        onStartEdit={handleStartEdit}
        onFinishEdit={handleFinishEdit}
        onCancelEdit={handleCancelEdit}
        forceShowNumber={true}
        activeRef={activeRef}
        repertoires={repertoires}
        onAddToRepertoire={onAddToRepertoire}
        deviationFen={deviationFen}
        deviationMove={deviationMove}
      />
      {result && result !== '*' && (
        <span className="ml-1 font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
          {result}
        </span>
      )}
    </div>
  )
}

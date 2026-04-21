import { Group, Panel, Separator } from 'react-resizable-panels'
import type { LayoutNode, PanelId } from './types'
import PanelContainer from './PanelContainer'
import { PANEL_DEFS } from './panelRegistry'

interface MosaicNodeProps {
  node: LayoutNode
  onRemove: (panelId: PanelId) => void
  onSetActiveTab: (leafId: string, tabIdx: number) => void
  isOnlyPanel: boolean
}

export default function MosaicNode({ node, onRemove, onSetActiveTab, isOnlyPanel }: MosaicNodeProps) {
  if (node.type === 'leaf') {
    return (
      <PanelContainer
        leafId={node.id}
        panels={node.panels}
        activeIdx={node.activeIdx}
        onRemove={onRemove}
        onSetActiveTab={(tabIdx) => onSetActiveTab(node.id, tabIdx)}
        isOnlyPanel={isOnlyPanel}
      >
        {node.panels.map((panelId, idx) => {
          const PanelComponent = PANEL_DEFS[panelId].component
          return (
            <div
              key={panelId}
              style={{ display: idx === node.activeIdx ? 'contents' : 'none', height: '100%' }}
            >
              <PanelComponent />
            </div>
          )
        })}
      </PanelContainer>
    )
  }

  const isH = node.direction === 'h'

  return (
    <Group
      key={node.id}
      orientation={isH ? 'horizontal' : 'vertical'}
      style={{ height: '100%', width: '100%' }}
    >
      <Panel defaultSize={50} minSize={10}>
        <MosaicNode node={node.first} onRemove={onRemove} onSetActiveTab={onSetActiveTab} isOnlyPanel={isOnlyPanel} />
      </Panel>
      <Separator
        className={[
          'flex items-center justify-center shrink-0 group',
          isH ? 'w-1.5 h-full cursor-col-resize' : 'h-1.5 w-full cursor-row-resize',
        ].join(' ')}
      >
        <div
          className={[
            'rounded-full transition-all duration-100',
            'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]',
            'group-hover:bg-[var(--color-accent)] dark:group-hover:bg-[var(--color-dark-accent)]',
            'group-active:bg-[var(--color-accent)] dark:group-active:bg-[var(--color-dark-accent)]',
            isH ? 'w-px h-10 group-hover:w-0.5' : 'h-px w-10 group-hover:h-0.5',
          ].join(' ')}
        />
      </Separator>
      <Panel defaultSize={50} minSize={10}>
        <MosaicNode node={node.second} onRemove={onRemove} onSetActiveTab={onSetActiveTab} isOnlyPanel={isOnlyPanel} />
      </Panel>
    </Group>
  )
}

import type { LucideIcon } from 'lucide-react'
import { Grid2x2, BookOpen, Cpu, BarChart2, SquareChevronRight, Database } from 'lucide-react'
import type { PanelId } from './types'
import BoardPanel                from './panels/BoardPanel'
import NotationPanel             from './panels/NotationPanel'
import EnginePanel               from '@/components/EnginePanel'
import AnalysisPanel             from './panels/AnalysisPanel'
import RepertoireBoardPanel      from './panels/RepertoireBoardPanel'
import RepertoireTreePanel       from './panels/RepertoireTreePanel'
import ExplorerPanel             from './panels/ExplorerPanel'
import RepertoireExplorerPanel   from './panels/RepertoireExplorerPanel'

interface PanelDef {
  id:        PanelId
  label:     string
  icon:      LucideIcon
  component: React.ComponentType
}

export const PANEL_DEFS: Record<PanelId, PanelDef> = {
  board:    { id: 'board',    label: 'Board',    icon: Grid2x2,             component: BoardPanel            },
  notation: { id: 'notation', label: 'Notation', icon: BookOpen,            component: NotationPanel         },
  engine:   { id: 'engine',   label: 'Engine',   icon: Cpu,                 component: EnginePanel           },
  analysis: { id: 'analysis', label: 'Analysis', icon: BarChart2,           component: AnalysisPanel         },
  explorer: { id: 'explorer', label: 'Explorer', icon: Database,            component: ExplorerPanel         },

  'repertoire-board':    { id: 'repertoire-board',    label: 'Board',    icon: Grid2x2,             component: RepertoireBoardPanel    },
  'repertoire-tree':     { id: 'repertoire-tree',     label: 'Moves',    icon: SquareChevronRight,  component: RepertoireTreePanel     },
  'repertoire-database': { id: 'repertoire-database', label: 'Explorer', icon: Database,            component: RepertoireExplorerPanel },
  'repertoire-engine':   { id: 'repertoire-engine',   label: 'Engine',   icon: Cpu,                 component: EnginePanel             },
}

// Panel IDs shown in the Home page toolbar
export const ALL_PANEL_IDS: PanelId[] = ['board', 'notation', 'engine', 'analysis', 'explorer']

// Panel IDs shown in the Repertoire Builder toolbar
export const ALL_REPERTOIRE_PANEL_IDS: PanelId[] = [
  'repertoire-board', 'repertoire-tree', 'repertoire-database', 'repertoire-engine',
]

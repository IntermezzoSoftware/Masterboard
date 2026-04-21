import { createMemoryRouter } from 'react-router'
import AppLayout from '@/components/AppLayout'
import BoardPage from '@/pages/BoardPage'
import GamesPage from '@/pages/GamesPage'
import RecordPage from '@/pages/RecordPage'
import OpeningsPage from '@/pages/OpeningsPage'
import RepertoireBuilderPage from '@/pages/RepertoireBuilderPage'
import DrillPage from '@/pages/DrillPage'
import SettingsPage from '@/pages/SettingsPage'
import StatisticsPage from '@/pages/StatisticsPage'
import TacticsPage from '@/pages/TacticsPage'
import ReportsPage from '@/pages/ReportsPage'
import GTMPage from '@/pages/GTMPage'

export const router = createMemoryRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true,               element: <BoardPage />              },
        { path: 'board',             element: <BoardPage />              },
        { path: 'games',             element: <GamesPage />              },
        { path: 'record',            element: <RecordPage />             },
        { path: 'openings',          element: <OpeningsPage />           },
        { path: 'openings/drill',    element: <DrillPage />              },
        { path: 'openings/:id',      element: <RepertoireBuilderPage />  },
        { path: 'settings',          element: <SettingsPage />           },
        { path: 'statistics',        element: <StatisticsPage />         },
        { path: 'tactics',           element: <TacticsPage />            },
        { path: 'guess-the-move',    element: <GTMPage />                },
        { path: 'reports',           element: <ReportsPage />            },
      ],
    },
  ],
  { initialEntries: ['/board'] }
)

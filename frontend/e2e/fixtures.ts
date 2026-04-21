import { test as base, type Page } from '@playwright/test'

export { expect } from '@playwright/test'
export type { Page }

// Engine mock data
// Verbatim-style EngineInfo payloads representing Stockfish depth 1–20 output
// on the starting position.  Values mirror real Stockfish output for
// `position startpos` + `go depth 20`.

export interface EngineInfoPayload {
  depth: number; selDepth: number; multiPV: number
  scoreCp: number; isMate: boolean; scoreMate: number
  nodes: number; timeMs: number; pvUci: string[]
}

export const STOCKFISH_DEPTH20_EVENTS: EngineInfoPayload[] = [
  { depth: 1,  selDepth: 1,  multiPV: 1, scoreCp: 35, isMate: false, scoreMate: 0, nodes: 20,      timeMs: 1,    pvUci: ['e2e4'] },
  { depth: 2,  selDepth: 2,  multiPV: 1, scoreCp: 20, isMate: false, scoreMate: 0, nodes: 56,      timeMs: 1,    pvUci: ['e2e4', 'e7e5'] },
  { depth: 3,  selDepth: 4,  multiPV: 1, scoreCp: 30, isMate: false, scoreMate: 0, nodes: 198,     timeMs: 1,    pvUci: ['e2e4', 'e7e5', 'g1f3'] },
  { depth: 4,  selDepth: 5,  multiPV: 1, scoreCp: 18, isMate: false, scoreMate: 0, nodes: 870,     timeMs: 2,    pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] },
  { depth: 5,  selDepth: 7,  multiPV: 1, scoreCp: 25, isMate: false, scoreMate: 0, nodes: 3200,    timeMs: 3,    pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'] },
  { depth: 6,  selDepth: 8,  multiPV: 1, scoreCp: 22, isMate: false, scoreMate: 0, nodes: 9800,    timeMs: 5,    pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'] },
  { depth: 7,  selDepth: 10, multiPV: 1, scoreCp: 28, isMate: false, scoreMate: 0, nodes: 31000,   timeMs: 9,    pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4'] },
  { depth: 8,  selDepth: 12, multiPV: 1, scoreCp: 24, isMate: false, scoreMate: 0, nodes: 87000,   timeMs: 22,   pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'] },
  { depth: 9,  selDepth: 13, multiPV: 1, scoreCp: 26, isMate: false, scoreMate: 0, nodes: 210000,  timeMs: 51,   pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'] },
  { depth: 10, selDepth: 15, multiPV: 1, scoreCp: 23, isMate: false, scoreMate: 0, nodes: 520000,  timeMs: 120,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'] },
  { depth: 11, selDepth: 16, multiPV: 1, scoreCp: 25, isMate: false, scoreMate: 0, nodes: 980000,  timeMs: 221,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1'] },
  { depth: 12, selDepth: 17, multiPV: 1, scoreCp: 22, isMate: false, scoreMate: 0, nodes: 1500000, timeMs: 335,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5'] },
  { depth: 13, selDepth: 18, multiPV: 1, scoreCp: 27, isMate: false, scoreMate: 0, nodes: 2100000, timeMs: 468,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3'] },
  { depth: 14, selDepth: 20, multiPV: 1, scoreCp: 24, isMate: false, scoreMate: 0, nodes: 2800000, timeMs: 621,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6'] },
  { depth: 15, selDepth: 22, multiPV: 1, scoreCp: 26, isMate: false, scoreMate: 0, nodes: 3200000, timeMs: 712,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3'] },
  { depth: 16, selDepth: 23, multiPV: 1, scoreCp: 23, isMate: false, scoreMate: 0, nodes: 3500000, timeMs: 778,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8'] },
  { depth: 17, selDepth: 24, multiPV: 1, scoreCp: 25, isMate: false, scoreMate: 0, nodes: 3800000, timeMs: 843,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8', 'h2h3'] },
  { depth: 18, selDepth: 25, multiPV: 1, scoreCp: 24, isMate: false, scoreMate: 0, nodes: 4000000, timeMs: 889,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8', 'h2h3', 'c8b7'] },
  { depth: 19, selDepth: 26, multiPV: 1, scoreCp: 26, isMate: false, scoreMate: 0, nodes: 4300000, timeMs: 954,  pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8', 'h2h3', 'c8b7', 'd2d4'] },
  { depth: 20, selDepth: 27, multiPV: 1, scoreCp: 25, isMate: false, scoreMate: 0, nodes: 4500000, timeMs: 1002, pvUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8', 'h2h3', 'c8b7', 'd2d4', 'b8d7'] },
]

export const STOCKFISH_BESTMOVE = 'e2e4'


export const MOCK_FOLDERS = [
  { id: 'folder-openings', name: 'Openings', parentId: null },
  { id: 'folder-tactics',  name: 'Tactics',  parentId: null },
  // Sicilian is a child of Openings — lets us test expand/collapse + leaf alignment
  { id: 'folder-sicilian', name: 'Sicilian', parentId: 'folder-openings' },
]

export const MOCK_GAMES = [
  {
    id: 'game-1',
    white: 'Kasparov',
    black: 'Karpov',
    whiteElo: 2800,
    blackElo: 2750,
    result: '1-0',
    date: '1985.01.01',
    event: 'World Championship',
    eco: 'B20',
    opening: 'Sicilian',
    timeControl: '40/7200',
    source: 'pgn',
    folderId: null,
    collectionNames: [],
  },
  {
    id: 'game-2',
    white: 'Fischer',
    black: 'Spassky',
    whiteElo: 2785,
    blackElo: 2660,
    result: '1-0',
    date: '1972.07.11',
    event: 'World Championship',
    eco: 'D86',
    opening: 'Grunfeld',
    timeControl: '40/7200',
    source: 'lichess',
    folderId: null,
    collectionNames: ['Classics'],
  },
]

// Games where one is in a folder and one is unfiled — used for folder-filter tests.
export const MOCK_GAMES_WITH_FOLDER = [
  {
    id: 'game-1',
    white: 'Kasparov',
    black: 'Karpov',
    whiteElo: 2800,
    blackElo: 2750,
    result: '1-0',
    date: '1985.01.01',
    event: 'World Championship',
    eco: 'B20',
    opening: 'Sicilian',
    timeControl: '40/7200',
    source: 'pgn',
    folderId: 'folder-openings',
    collectionNames: [],
  },
  {
    id: 'game-2',
    white: 'Fischer',
    black: 'Spassky',
    whiteElo: 2785,
    blackElo: 2660,
    result: '1-0',
    date: '1972.07.11',
    event: 'World Championship',
    eco: 'D86',
    opening: 'Grunfeld',
    timeControl: '40/7200',
    source: 'lichess',
    folderId: null,
    collectionNames: [],
  },
]


export const MOCK_REPERTOIRES = [
  { id: 'rep-1', name: 'Ruy Lopez', colour: 'white', description: '' },
  { id: 'rep-2', name: 'Sicilian', colour: 'black', description: '' },
]

// A small linear repertoire tree: 1. e4 e5 2. Nf3
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const FEN_AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const FEN_AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const FEN_AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

export const MOCK_REPERTOIRE_MOVES = [
  {
    id: 'move-1', repertoireId: 'rep-1', parentId: null,
    fromFen: INITIAL_FEN, toFen: FEN_AFTER_E4,
    moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0, nag: null, comment: '', shapes: '',
  },
  {
    id: 'move-2', repertoireId: 'rep-1', parentId: 'move-1',
    fromFen: FEN_AFTER_E4, toFen: FEN_AFTER_E5,
    moveSan: 'e5', moveUci: 'e7e5', moveOrder: 0, nag: null, comment: '', shapes: '',
  },
  {
    id: 'move-3', repertoireId: 'rep-1', parentId: 'move-2',
    fromFen: FEN_AFTER_E5, toFen: FEN_AFTER_NF3,
    moveSan: 'Nf3', moveUci: 'g1f3', moveOrder: 0, nag: null, comment: '', shapes: '',
  },
]

export const MOCK_PREVIEW_GAMES = [
  {
    white: 'Alice',
    black: 'Bob',
    whiteElo: 1500,
    blackElo: 1400,
    result: '1-0',
    date: '2024.01.15',
    event: '',
    site: '',
    round: '',
    eco: '',
    timeControl: '300+0',
    source: 'lichess',
    sourceId: 'abc123',
    pgn: '',
  },
]

// Wails bridge mock
// Injected into the browser page before the app loads, replacing the real
// window.go.main.App IPC bridge that Wails would provide at runtime.

export interface BridgeOptions {
  games?: object[]
  previewGames?: object[]
  settings?: Record<string, string>
  repertoires?: object[]
  repertoireMoves?: object[]
  /** When true, GetEngineState returns isReady:true and StartAnalysis fires engineEvents. */
  engineReady?: boolean
  engineEvents?: object[]
  /** Cards returned by GetDrillSession (default: []). */
  drillCards?: object[]
  /**
   * When true, GetDrillSession returns drillCards on the first call and [] on
   * all subsequent calls within the same page session.  Use this to drive the
   * DrillPage to the completion screen without board interaction.
   */
  drillCardsDrainOnce?: boolean
  /** Summary returned by GetDrillSummary (default: zeroed). */
  drillSummary?: object
  /** Count returned by GetDrillCount (default: 0). */
  drillCount?: number
}

export async function installBridge(page: Page, folders = MOCK_FOLDERS, options: BridgeOptions = {}) {
  const { games = [], previewGames = [], settings = {}, repertoires = [], repertoireMoves = [], engineReady = false, engineEvents = [], drillCards = [], drillCardsDrainOnce = false, drillSummary = { totalReviewed: 0, correctCount: 0, incorrectCount: 0, newToLearning: 0, lapsedToRelearn: 0 }, drillCount = 0 } = options
  await page.addInitScript((data: { folders: object[]; games: object[]; previewGames: object[]; settings: Record<string, string>; repertoires: object[]; repertoireMoves: object[]; engineReady: boolean; engineEvents: object[]; drillCards: object[]; drillCardsDrainOnce: boolean; drillSummary: object; drillCount: number }) => {
    // Real in-memory event bus — lets tests trigger engine events via _emitEngineInfo().
    // EventsOnMultiple stores handlers by event name; EventsEmit calls them synchronously.
    var _handlers: Record<string, Array<(payload: unknown) => void>> = {}
    ;(window as any).runtime = {
      EventsOnMultiple: function(eventName: string, callback: (payload: unknown) => void) {
        if (!_handlers[eventName]) _handlers[eventName] = []
        _handlers[eventName].push(callback)
        return function() {
          var arr = _handlers[eventName]
          if (arr) { var i = arr.indexOf(callback); if (i !== -1) arr.splice(i, 1) }
        }
      },
      EventsOff: function(eventName: string) { delete _handlers[eventName] },
      EventsEmit: function(eventName: string, payload: unknown) {
        var arr = _handlers[eventName]
        if (arr) arr.slice().forEach(function(fn) { fn(payload) })
      },
      LogPrint: () => {}, LogTrace: () => {}, LogDebug: () => {},
      LogInfo: () => {}, LogWarning: () => {}, LogError: () => {}, LogFatal: () => {},
      WindowMinimise: () => {}, WindowToggleMaximise: () => {},
      WindowIsMaximised: () => false, Quit: () => {},
    }

    let _folders = data.folders
    const _settings: Record<string, string> = { ...data.settings }
    let _repertoires = (data as any).repertoires.slice()
    let _repertoireMoves = (data as any).repertoireMoves.slice()
    const bridge = {
      // Games
      ListGames: async (filters: any) => {
        let result = (data.games as any[]).slice()
        if (filters?.player) {
          const p = filters.player.toLowerCase()
          result = result.filter((g: any) =>
            g.white.toLowerCase().includes(p) || g.black.toLowerCase().includes(p))
        }
        if (filters?.result) result = result.filter((g: any) => g.result === filters.result)
        if (filters?.source) result = result.filter((g: any) => g.source === filters.source)
        if (filters?.folderId) result = result.filter((g: any) => g.folderId === filters.folderId)
        if (filters?.unfiled) result = result.filter((g: any) => !g.folderId)
        return result
      },
      GetGame:      async () => null,
      SaveGame:     async () => 'game-id',
      UpdateGame:   async () => undefined,
      DeleteGame:   async () => undefined,

      // PGN import
      ImportPGNFile:       async () => [],
      OpenFileDialog:      async () => '',
      OpenDirectoryDialog: async () => '',
      ImportPGNFolder:     async () => [],

      // External import
      ImportFromLichess:   async () => 0,
      ImportFromChessCom:  async () => 0,
      PreviewFromLichess:  async () => data.previewGames,
      PreviewFromChessCom: async () => data.previewGames,
      ImportSelectedGames: async (chosen: object[]) => chosen.map((_, i) => `imported-game-${i}`),

      // Collections
      ListCollections:          async () => [],
      CreateCollection:         async () => 'coll-id',
      DeleteCollection:         async () => undefined,
      AddGameToCollection:      async () => undefined,
      RemoveGameFromCollection: async () => undefined,
      ListGameCollections:      async () => [],

      // Folders — these mutate _folders so tests can verify round-trips
      ListFolders: async () => _folders,
      CreateFolder: async (name: string, parentId: string | null) => {
        const id = `folder-${Date.now()}`
        _folders = [..._folders, { id, name, parentId }]
        return id
      },
      RenameFolder: async (id: string, name: string) => {
        _folders = _folders.map((f: { id: string; name: string; parentId: string | null }) =>
          f.id === id ? { ...f, name } : f
        )
      },
      DeleteFolder: async (id: string) => {
        _folders = _folders.filter((f: { id: string }) => f.id !== id)
      },
      DeleteFolderWithGames: async (id: string) => {
        _folders = _folders.filter((f: { id: string }) => f.id !== id)
      },
      MoveGameToFolder: async () => undefined,

      // Settings
      GetSetting: async (key: string) => _settings[key] ?? '',
      SetSetting: async (key: string, value: string) => { _settings[key] = value },
      GetIdentityNames: async () => [],

      // Repertoires — mutable in-memory state so tests can verify round-trips
      ListRepertoires: async () => _repertoires,
      CreateRepertoire: async (name: string, colour: string) => {
        const id = `rep-${Date.now()}`
        _repertoires = [..._repertoires, { id, name, colour, description: '' }]
        return id
      },
      RenameRepertoire: async (id: string, name: string) => {
        _repertoires = _repertoires.map((r: any) => r.id === id ? { ...r, name } : r)
      },
      DeleteRepertoire: async (id: string) => {
        _repertoires = _repertoires.filter((r: any) => r.id !== id)
      },
      LoadRepertoire: async (id: string) => {
        const rep = _repertoires.find((r: any) => r.id === id)
        if (!rep) return null
        return { repertoire: rep, moves: _repertoireMoves.filter((m: any) => m.repertoireId === id) }
      },
      SaveRepertoireMove: async (move: any) => {
        const id = `move-${Date.now()}`
        _repertoireMoves = [..._repertoireMoves, { ...move, id }]
        return id
      },
      UpdateRepertoireMove: async (move: any) => {
        _repertoireMoves = _repertoireMoves.map((m: any) => m.id === move.id ? { ...m, ...move } : m)
      },
      DeleteRepertoireBranch: async (moveId: string) => {
        // Simple: remove the move and all descendants
        const toDelete = new Set<string>()
        const queue = [moveId]
        while (queue.length) {
          const id = queue.shift()!
          toDelete.add(id)
          _repertoireMoves.filter((m: any) => m.parentId === id).forEach((m: any) => queue.push(m.id))
        }
        _repertoireMoves = _repertoireMoves.filter((m: any) => !toDelete.has(m.id))
      },
      GetMovesForPosition: async (repertoireId: string, fen: string) => {
        return _repertoireMoves.filter((m: any) => m.repertoireId === repertoireId && m.fromFen === fen)
      },
      ClassifyPosition: async () => null,

      // Engine
      GetEngineState: async () => ({
        isReady: data.engineReady,
        isAnalysing: false,
        activeEngine: data.engineReady ? 'stockfish' : '',
        availableEngines: data.engineReady ? ['stockfish'] : [],
      }),
      StartAnalysis: async (fen: string, multiPV: number) => {
        ;(window as any)._engineCalls = (window as any)._engineCalls ?? []
        ;(window as any)._engineCalls.push({ method: 'StartAnalysis', fen, multiPV })
        ;(data.engineEvents as any[]).forEach(function(info: unknown, i: number) {
          setTimeout(function() { (window as any).runtime.EventsEmit('engine:info', info) }, i * 5)
        })
      },
      StopAnalysis: async () => {
        ;(window as any)._engineCalls = (window as any)._engineCalls ?? []
        ;(window as any)._engineCalls.push({ method: 'StopAnalysis' })
      },
      SetActiveEngine: async () => undefined,
      SetEngineOption: async () => undefined,
      ListEngines: async () => (data.engineReady ? ['stockfish'] : []),
      BrowseForEngine: async () => '',
      GetCustomEngines: async () => [],
      AddCustomEngine: async () => undefined,
      RemoveCustomEngine: async () => undefined,
      GetMasterDBStatus: async () => ({ state: 'not-configured', totalGames: 0, fileCount: 0, lastImport: '', filenames: [] }),
      OpenMasterDBFileDialog: async () => null,
      GetFileSizes: async () => [],
      StartMasterDBImport: async () => undefined,
      CancelMasterDBImport: async () => undefined,
      GetMasterPositionStats: async () => [],
      GetMasterGamesAtPosition: async () => [],
      GetAllRepertoireMoves: async () => [],

      // Drill / SRS
      GetDrillSession: (() => {
        let _remaining: object[] = (data as any).drillCards.slice()
        return async () => {
          if ((data as any).drillCardsDrainOnce) {
            const cards = _remaining
            _remaining = []
            return cards
          }
          return (data as any).drillCards
        }
      })(),
      GetDrillCount:       async () => (data as any).drillCount,
      RecordDrillResult:   async () => undefined,
      GetDrillSummary:     async () => (data as any).drillSummary,
      ResetDrillScope:     async () => undefined,
      GetRepertoireHeatmap: async () => [],

      // Player statistics (Epic 5.1)
      GetPlayerStats: async () => ({
        totalGames: 0, analyzedGames: 0,
        asWhite: { wins: 0, draws: 0, losses: 0, total: 0 },
        asBlack: { wins: 0, draws: 0, losses: 0, total: 0 },
        byTimeControl: [], byOpening: [],
      }),
      GetPlayerAnalysisStats: async () => ({
        accuracyTimeSeries: [], blunderHeatmap: [], blunderPositions: [],
        luckStats: { blunderCount: 0, unpunishedBlunders: 0, luckRate: 0, oppBlunderCount: 0, exploitedBlunders: 0, opportunismRate: 0 },
      }),

      // Opening deviation detection
      DetectDeviation:  async () => null,
      GetGameDeviation: async () => null,
      DetectDeviations: async () => [],

      // Window / platform
      SetTitleBarTheme: async () => undefined,
      GetPlatform: async () => 'windows',
    };
    (window as any).go = { main: { App: bridge } }
    // Disable the splash screen in E2E tests so it doesn't block pointer events.
    localStorage.setItem('masterboard-splashEnabled', 'false')
  }, { folders, games, previewGames, settings, repertoires, repertoireMoves, engineReady, engineEvents, drillCards, drillCardsDrainOnce, drillSummary, drillCount })
}


interface Fixtures {
  /** Games page with empty game list (default). */
  gamesPage: Page
  /** Games page with MOCK_GAMES in the game list. */
  gamesListPage: Page
  /** Games page with one game in a folder and one unfiled (for folder-filter tests). */
  gamesWithFolderPage: Page
  /** Games page with preview game data + Lichess username set (for import tests). */
  gamesImportPage: Page
  /** Home page (default layout). */
  boardPage: Page
  /** Home page with engine ready; GetEngineState returns isReady:true and StartAnalysis fires STOCKFISH_DEPTH20_EVENTS. */
  boardPageWithEngine: Page
  /** Record page. */
  recordPage: Page
  /** Settings page (master DB not indexed — default). */
  settingsPage: Page
  /** Openings list page with MOCK_REPERTOIRES loaded. */
  openingsPage: Page
  /** Repertoire builder page for MOCK_REPERTOIRES[0], with MOCK_REPERTOIRE_MOVES. */
  openingsBuilderPage: Page
}

export const test = base.extend<Fixtures>({
  gamesPage: async ({ page }, use) => {
    await installBridge(page)
    await page.goto('/')
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await use(page)
  },

  gamesListPage: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, { games: MOCK_GAMES })
    await page.goto('/')
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await use(page)
  },

  gamesWithFolderPage: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, { games: MOCK_GAMES_WITH_FOLDER })
    await page.goto('/')
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await use(page)
  },

  gamesImportPage: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, {
      previewGames: MOCK_PREVIEW_GAMES,
      settings: { 'lichess.username': 'testuser' },
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await use(page)
  },

  boardPage: async ({ page }, use) => {
    await installBridge(page)
    await page.goto('/')
    // Board is the default page — wait for toolbar to confirm render
    await page.getByRole('button', { name: 'Save game' }).waitFor()
    await use(page)
  },

  boardPageWithEngine: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, {
      engineReady: true,
      engineEvents: STOCKFISH_DEPTH20_EVENTS,
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Save game' }).waitFor()
    // Wait for isReady to propagate so Start button is enabled
    await page.getByTestId('engine-start-btn').waitFor()
    await use(page)
  },

  recordPage: async ({ page }, use) => {
    await installBridge(page)
    await page.goto('/')
    await page.getByRole('link', { name: 'Games' }).click()
    await page.getByText('All Games').waitFor()
    await page.getByRole('button', { name: 'Record' }).click()
    await page.getByText('Record game').waitFor()
    await use(page)
  },

  settingsPage: async ({ page }, use) => {
    await installBridge(page)
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByText('Connected Accounts').waitFor()
    await use(page)
  },

  openingsPage: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, {
      repertoires: MOCK_REPERTOIRES,
      repertoireMoves: MOCK_REPERTOIRE_MOVES,
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Openings' }).click()
    // Wait for the repertoire list to load (heading was removed in custom-titlebar refactor)
    await page.getByText('Ruy Lopez').waitFor()
    await use(page)
  },

  openingsBuilderPage: async ({ page }, use) => {
    await installBridge(page, MOCK_FOLDERS, {
      repertoires: MOCK_REPERTOIRES,
      repertoireMoves: MOCK_REPERTOIRE_MOVES,
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Openings' }).click()
    await page.getByText('Ruy Lopez').waitFor()
    // Click the first repertoire row to open the builder
    await page.getByText('Ruy Lopez').click()
    await page.getByTestId('repertoire-board').waitFor()
    await use(page)
  },

})

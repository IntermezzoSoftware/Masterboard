/**
 * Type-safe wrappers for all Wails IPC calls.
 *
 * Wails auto-generates JS bindings at frontend/src/wailsjs/ when `wails dev`
 * or `wails build` runs. This file wraps those calls with proper TypeScript
 * types so the rest of the app never imports from wailsjs directly.
 *
 * During development before running `wails dev`, calls go through
 * window.go.main.App — the same mechanism the generated bindings use.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
function go(method: string, ...args: any[]): Promise<any> {
  const bridge = (window as any)?.go?.main?.App
  if (!bridge) {
    return Promise.reject(new Error('Wails bridge not available'))
  }
  if (typeof bridge[method] !== 'function') {
    return Promise.reject(new Error(`Bridge method not available: ${method}`))
  }
  return bridge[method](...args)
}


export interface ECOEntry {
  eco: string
  name: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
}

export interface GameSummary {
  id: string
  white: string
  black: string
  whiteElo: number | null
  blackElo: number | null
  result: string
  date: string
  event: string
  eco: string
  opening: string
  timeControl: string
  source: string
  collectionNames: string[]
  folderId: string | null
  analysisStatus: string | null
}

export interface GameRecord extends GameSummary {
  site: string
  round: string
  pgn: string
}

export interface GameInput {
  white: string
  black: string
  whiteElo?: number | null
  blackElo?: number | null
  result: string
  date: string
  event: string
  site: string
  round: string
  eco: string
  opening?: string
  timeControl: string
  source: string
  sourceId?: string
  pgn: string
}

export interface GameMetadataInput {
  white: string
  black: string
  whiteElo: number | null
  blackElo: number | null
  result: string
  date: string
  event: string
  site: string
  round: string
  eco: string
  opening: string
}

export interface GameFilters {
  player?: string
  white?: string
  black?: string
  result?: string
  eco?: string
  dateFrom?: string
  dateTo?: string
  source?: string
  collectionId?: string
  folderId?: string
  includeSubfolders?: boolean
  unfiled?: boolean
  playerNames?: string[]
  limit?: number
  offset?: number
}

export interface ImportFilters {
  dateFrom?: string
  dateTo?: string
  timeControls?: string[]  // subset of "bullet" | "blitz" | "rapid" | "classical" | "correspondence"; omit for all
  maxGames?: number
}

export interface Collection {
  id: string
  name: string
  description: string
}

export interface Repertoire {
  id: string
  name: string
  colour: 'white' | 'black'
  description: string
}

export interface RepertoireMove {
  id: string
  repertoireId: string
  parentId: string | null
  fromFen: string
  toFen: string
  moveSan: string
  moveUci: string
  moveOrder: number
  nag: number | null
  comment: string
  shapes: string
  isTransposition: boolean
}

export interface RepertoireData {
  repertoire: Repertoire
  moves: RepertoireMove[]
}

export interface ReorderUpdate { id: string; newOrder: number }
export interface WeightOverride { fromFen: string; moveUci: string; weight: number }


export interface EngineInfo {
  depth: number
  selDepth: number
  multiPV: number
  scoreCp: number
  isMate: boolean
  scoreMate: number
  nodes: number
  timeMs: number
  pvUci: string[]
}

export type EngineType = 'ab' | 'mcts'

export interface EngineEntry {
  path: string
  name: string
}

export interface EngineState {
  isReady: boolean
  isAnalysing: boolean
  activeEngine: string
  availableEngines: EngineEntry[]
  engineName: string
  engineType: EngineType
}

export interface DownloadableEngine {
  id: string
  name: string
  description: string
  version: string
  downloadURL: string
  networkURL: string
}


export interface MoveEval {
  ply: number
  bestCp: number | null
  bestMate: number | null
  playedCp: number | null
  playedMate: number | null
  bestPv: string
  accuracy: number
  nag: number | null
}

export interface DeviationResult {
  gameId: string
  deviationPly: number        // -1 = in-repertoire / not personal / no repertoire
  deviationFen: string        // FEN before the deviation move
  playerWentOffBook: boolean  // true = player deviated; false = opponent surprised player
  repertoireId: string
  expectedMoves: string[]     // SAN list of moves the repertoire had at that position
  playedMove: string          // SAN of the move actually played
}

export interface AnalysisRecord {
  gameId: string
  depth: number
  whiteAccuracy: number | null
  blackAccuracy: number | null
  whiteAcpl: number | null
  blackAcpl: number | null
  status: 'pending' | 'running' | 'complete' | 'error'
  errorMsg: string
  analysedAt: string
  pgnAnnotated: boolean
}

export interface GameAnalysisResult extends AnalysisRecord {
  evals: MoveEval[]
  appliedEvals: MoveEval[]
}

export interface AnalysisProgress {
  gameId: string
  ply: number
  totalPlies: number
}

export interface AnalysisComplete {
  gameId: string
  whiteAccuracy: number | null
  blackAccuracy: number | null
  whiteAcpl: number | null
  blackAcpl: number | null
  status: string
  errorMsg: string
}

export interface AnalysisQueueUpdate {
  remaining: number
  active: number
}


export interface MasterDBStatus {
  state: 'not-configured' | 'indexed'
  importing: boolean   // true while a background import is running
  totalGames: number
  fileCount: number
  lastImport: string   // ISO-8601 UTC or ""
  filenames: string[]  // distinct source filenames, for hover tooltip
}

export interface MasterDBProgressEvent {
  gamesProcessed: number
  currentFile: string
  fileIndex: number   // 1-based
  totalFiles: number
  phase: string       // "processing" | "building-stats" | "building-index" | "optimizing"
  phaseDone: number   // rows written in current phase (stats/index)
  phaseTotal: number  // total rows to write in current phase
}

export interface MasterDBCompleteEvent {
  success: boolean
  gamesIndexed: number
  errorMsg: string
}

export interface MasterMoveStat {
  moveSan: string
  whiteWins: number
  draws: number
  blackWins: number
  avgElo: number
  total: number
}

export interface MasterGameSummary {
  id: number
  white: string
  black: string
  result: string
  date: string
  eloWhite: number
  eloBlack: number
  moveSan: string
}

export interface PersonalMoveStat {
  moveSan: string
  whiteWins: number
  draws: number
  blackWins: number
  avgElo: number
  total: number
  avgAccuracy: number // 0 if no analysis data
}

export interface PersonalGameSummary {
  id: string
  white: string
  black: string
  result: string
  date: string
  whiteElo: number | null
  blackElo: number | null
  timeControl: string
  moveSan: string
}

export interface PersonalPositionFilters {
  folderId?: string
  collectionId?: string
  playerName?: string
  playerNames?: string[] // multi-identity "Myself" filter
  playerSide?: string    // "white", "black", or ""
  sortBy?: string        // "elo" (default) or "date"
  dateFrom?: string      // "YYYY-MM-DD"
  dateTo?: string        // "YYYY-MM-DD" inclusive
}

export interface IndexingStatus {
  indexed: number
  total: number
}


export interface DrillScope {
  colour?: string      // '' | 'white' | 'black'
  repertoireId?: string
  rootMoveId?: string  // if set, restrict drill to the subtree rooted at this move
  ignoreSchedule?: boolean
}

export interface DrillMove {
  moveId: string
  san: string
  uci: string
  toFen: string
  comment: string
  nag: number | null
}

export interface PrecedingMove {
  san: string
  uci: string
  fromFen: string
}

export interface SiblingMove {
  moveId: string
  san: string
  uci: string
  toFen: string
  due: boolean
}

export interface DrillCard {
  repertoireId: string
  colour: 'white' | 'black'
  fromFen: string
  correctMove: DrillMove
  siblingMoves?: SiblingMove[]
  precedingMove?: PrecedingMove
}

export interface DrillSummary {
  totalReviewed: number
  correctCount: number
  incorrectCount: number
  newToLearning: number
  lapsedToRelearn: number
}

export interface HeatmapEntry {
  moveId: string
  retrievability: number  // 0.0–1.0; 0 if never drilled
  state: number           // 0=New, 1=Learning, 2=Review, 3=Relearning
}


export interface DeviationRow {
  fen: string
  playerMove: string
  theoryMoves: string[]
  count: number
}

export interface RepertoireDeviationRow {
  fen: string
  playerMove: string
  repertoireMoves: string[]
  count: number
}


export interface StatsFilters {
  playerNames?: string[]
  folderId?: string
  collectionId?: string
  excludeFolderIds?: string[]
  excludeCollectionIds?: string[]
}

export interface ColourResults {
  wins: number
  draws: number
  losses: number
  total: number
}

export interface TimeControlResults {
  category: string
  results: ColourResults
}

export interface OpeningRow {
  eco: string
  opening: string
  games: number
  winPct: number
  drawPct: number
  lossPct: number
  asWhite: number
  asBlack: number
  whiteWins: number
  whiteDraws: number
  blackWins: number
  blackDraws: number
}

export interface OpeningTreeNode {
  eco: string
  opening: string
  games: number
  asWhite: number
  asBlack: number
  whiteWins: number
  whiteDraws: number
  blackWins: number
  blackDraws: number
  children?: OpeningTreeNode[]
}

export interface OpeningInfo {
  pgn: string
  fen: string
}

export interface ExplorerInitialState {
  tab: 'personal'
  playerFilter?: string
  playerSide?: 'white' | 'black'
  isMyselfActive?: boolean
}

export interface PlayerStats {
  totalGames: number
  analyzedGames: number
  asWhite: ColourResults
  asBlack: ColourResults
  byTimeControl: TimeControlResults[]
  byOpening: OpeningRow[]
}

export interface AccuracyPoint {
  date: string
  gameId: string
  playerSide: string
  playerAcc: number
  timeControl: string // bullet/blitz/rapid/classical/other
}

export interface BlunderSquare {
  square: string
  count: number
}

export interface BlunderPosition {
  fen: string
  count: number
}

export interface LuckStats {
  blunderCount: number
  unpunishedBlunders: number
  luckRate: number
  oppBlunderCount: number
  exploitedBlunders: number
  opportunismRate: number
}

export interface PlayerAnalysisStats {
  accuracyTimeSeries: AccuracyPoint[]
  blunderHeatmap: BlunderSquare[]
  blunderPositions: BlunderPosition[]
  luckStats: LuckStats
}


export interface PersonalPuzzle {
  id: string
  gameId: string
  ply: number
  fen: string
  solutionUci: string[]
  solutionSan: string[]
  playedMove: string
  classification: 'mistake' | 'blunder'
  playerColour: 'white' | 'black'
  playedCp: number | null
  bestCp: number | null
  white: string
  black: string
  date: string
}

export interface PuzzleSummary {
  totalReviewed: number
  correctCount: number
  incorrectCount: number
  newToLearning: number
  lapsedToRelearn: number
}

export interface TacticsLobbyStats {
  totalPuzzles: number
  dueCount: number
  lifetimeCorrect: number
  lifetimeTotal: number
}

export interface PuzzleFilters {
  classifications: string[]
  excludeAlreadyLosing: boolean
  alreadyLosingCp: number
}

export interface PuzzleHistoryEntry {
  puzzleId: string
  gameId: string
  fen: string
  classification: 'mistake' | 'blunder'
  playerColour: 'white' | 'black'
  playedMove: string
  reviewedAt: string
  correct: boolean
  white: string
  black: string
  date: string
}

export interface GTMMove {
  ply: number
  fromFen: string
  toFen: string
  san: string
  uci: string
  colour: 'white' | 'black'
  bestUci: string | null
  bestCp: number | null
  playedCp: number | null
}

export interface GTMGame {
  gameId: string
  white: string
  black: string
  date: string
  result: string
  analysed: boolean
  moves: GTMMove[]
}

export interface GTMRating {
  rating: number
  gamesPlayed: number
}

// ---------------------------------------------------------------------------
// Lichess OAuth & Studies (Task 9)
// ---------------------------------------------------------------------------

export interface StudyChapterMeta {
  id: string
  name: string
  orientation: 'white' | 'black'
}

export interface StudyMeta {
  id: string
  name: string
  chapters: StudyChapterMeta[]
  private: boolean
}

export interface ImportStudyRequest {
  studyId: string
  chapterIds: string[]
  destination: 'repertoire' | 'games'
  repertoireId: string
  repertoireName: string
  colour: 'white' | 'black'
  folderId: string
}

export interface ImportStudyResult {
  chaptersImported: number
  movesImported: number
  gamesImported: number
  duplicates: number
  repertoireId?: string
}

export interface LichessStudySummary {
  id: string
  name: string
  chapters: number
}

// ---------------------------------------------------------------------------
// Game CRUD
// ---------------------------------------------------------------------------

export const api = {
  listGames:   (filters: GameFilters = {})        => go('ListGames', filters)      as Promise<GameSummary[]>,
  getGame:     (id: string)                        => go('GetGame', id)             as Promise<GameRecord>,
  saveGame:           (input: GameInput)            => go('SaveGame', input)                   as Promise<string>,
  findDuplicateGame:  (input: GameInput)            => go('FindDuplicateGame', input)           as Promise<string>,
  updateGame:  (id: string, pgn: string, markAnnotated?: boolean, appliedEvalsJSON?: string) => go('UpdateGame', id, pgn, markAnnotated ?? false, appliedEvalsJSON ?? '') as Promise<void>,
  deleteGame:  (id: string)                        => go('DeleteGame', id)          as Promise<void>,
  updateGameMetadata: (id: string, m: GameMetadataInput) => go('UpdateGameMetadata', id, m) as Promise<void>,

  // PGN import
  importPGNFile:       (path: string)              => go('ImportPGNFile', path)          as Promise<string[]>,
  openFileDialog:      ()                          => go('OpenFileDialog')               as Promise<string>,
  openDirectoryDialog: ()                          => go('OpenDirectoryDialog')          as Promise<string>,
  importPGNFolder:     (dir: string)               => go('ImportPGNFolder', dir)         as Promise<string[]>,

  // External import
  importFromLichess:  (username: string, filters: ImportFilters = {}) =>
    go('ImportFromLichess', username, filters)  as Promise<number>,
  importFromChessCom: (username: string, filters: ImportFilters = {}) =>
    go('ImportFromChessCom', username, filters) as Promise<number>,

  // External import — preview (fetch without saving)
  previewFromLichess:  (username: string, filters: ImportFilters = {}) =>
    go('PreviewFromLichess', username, filters)  as Promise<GameInput[]>,
  previewFromChessCom: (username: string, filters: ImportFilters = {}) =>
    go('PreviewFromChessCom', username, filters) as Promise<GameInput[]>,
  importSelectedGames: (inputs: GameInput[]) =>
    go('ImportSelectedGames', inputs)            as Promise<string[]>,

  // Collections
  listCollections:          ()                                       => go('ListCollections')                           as Promise<Collection[]>,
  createCollection:         (name: string)                           => go('CreateCollection', name)                    as Promise<string>,
  deleteCollection:         (id: string)                             => go('DeleteCollection', id)                      as Promise<void>,
  addGameToCollection:      (gameID: string, collID: string)         => go('AddGameToCollection', gameID, collID)       as Promise<void>,
  removeGameFromCollection: (gameID: string, collID: string)         => go('RemoveGameFromCollection', gameID, collID)  as Promise<void>,
  listGameCollections:      (gameID: string)                         => go('ListGameCollections', gameID)               as Promise<Collection[]>,

  // Folders
  listFolders:      ()                                          => go('ListFolders')                                  as Promise<Folder[]>,
  createFolder:     (name: string, parentId: string | null)    => go('CreateFolder', name, parentId)                 as Promise<string>,
  renameFolder:     (id: string, name: string)                 => go('RenameFolder', id, name)                       as Promise<void>,
  deleteFolder:          (id: string)                          => go('DeleteFolder', id)                             as Promise<void>,
  deleteFolderWithGames: (id: string)                          => go('DeleteFolderWithGames', id)                    as Promise<void>,
  moveGameToFolder: (gameId: string, folderId: string | null)  => go('MoveGameToFolder', gameId, folderId)           as Promise<void>,

  // Repertoires
  listRepertoires:       ()                                                       => go('ListRepertoires')                                     as Promise<Repertoire[]>,
  createRepertoire:      (name: string, colour: string)                           => go('CreateRepertoire', name, colour)                       as Promise<string>,
  renameRepertoire:      (id: string, name: string)                               => go('RenameRepertoire', id, name)                           as Promise<void>,
  deleteRepertoire:      (id: string)                                             => go('DeleteRepertoire', id)                                 as Promise<void>,
  loadRepertoire:        (id: string)                                             => go('LoadRepertoire', id)                                   as Promise<RepertoireData>,
  saveRepertoireMove:    (move: RepertoireMove)                                   => go('SaveRepertoireMove', move)                             as Promise<string>,
  updateRepertoireMove:  (move: RepertoireMove)                                   => go('UpdateRepertoireMove', move)                           as Promise<void>,
  deleteRepertoireBranch:(moveId: string)                                         => go('DeleteRepertoireBranch', moveId)                       as Promise<void>,
  getMovesForPosition:   (repertoireId: string, fen: string)                      => go('GetMovesForPosition', repertoireId, fen)               as Promise<RepertoireMove[]>,
  reorderRepertoireMoves: (updates: ReorderUpdate[]) =>
    go('ReorderRepertoireMoves', updates) as Promise<void>,
  openPolyglotFileDialog: () =>
    go('OpenPolyglotFileDialog') as Promise<string>,
  openAndReadPGNFile: () =>
    go('OpenAndReadPGNFile') as Promise<string>,
  importPolyglotBook: (repertoireId: string, path: string, colour: string) =>
    go('ImportPolyglotBook', repertoireId, path, colour) as Promise<number>,
  exportRepertoireToPolyglot: (repertoireId: string, overrides: WeightOverride[]) =>
    go('ExportRepertoireToPolyglot', repertoireId, overrides) as Promise<string>,
  exportRepertoireToPGN: (repertoireId: string) =>
    go('ExportRepertoireToPGN', repertoireId) as Promise<string>,
  getAllRepertoireMoves: (fen: string) => go('GetAllRepertoireMoves', fen) as Promise<RepertoireData[]>,

  // ECO classification
  classifyPosition: (fen: string) => go('ClassifyPosition', fen) as Promise<ECOEntry | null>,

  // Settings
  getSetting: (key: string)               => go('GetSetting', key)         as Promise<string>,
  setSetting: (key: string, val: string)  => go('SetSetting', key, val)    as Promise<void>,

  // Engine
  startAnalysis:   (fen: string, multiPV: number)    => go('StartAnalysis', fen, multiPV)      as Promise<void>,
  stopAnalysis:    ()                                 => go('StopAnalysis')                     as Promise<void>,
  getEngineState:  ()                                 => go('GetEngineState')                   as Promise<EngineState>,
  setActiveEngine: (path: string)                     => go('SetActiveEngine', path)            as Promise<void>,
  setEngineOption: (name: string, value: string)      => go('SetEngineOption', name, value)     as Promise<void>,

  // Engine slot 2 (dual-engine mode)
  startAnalysis2:   (fen: string, multiPV: number)   => go('StartAnalysis2', fen, multiPV)     as Promise<void>,
  stopAnalysis2:    ()                                => go('StopAnalysis2')                    as Promise<void>,
  getEngineState2:  ()                                => go('GetEngineState2')                  as Promise<EngineState>,
  setActiveEngine2: (path: string)                    => go('SetActiveEngine2', path)           as Promise<void>,
  setEngineOption2: (name: string, value: string)     => go('SetEngineOption2', name, value)    as Promise<void>,
  rescanEngines:      ()                               => go('RescanEngines')                        as Promise<void>,
  deleteEngine:       (path: string)                   => go('DeleteEngine', path)                   as Promise<void>,
  unregisterEngine:   (path: string)                   => go('UnregisterEngine', path)               as Promise<void>,
  listEngines:        ()                               => go('ListEngines')                          as Promise<string[]>,
  browseForEngine:    ()                               => go('BrowseForEngine')                      as Promise<string>,
  getCustomEngines:   ()                               => go('GetCustomEngines')                     as Promise<string[]>,
  addCustomEngine:    (path: string)                   => go('AddCustomEngine', path)                as Promise<void>,
  removeCustomEngine:       (path: string)     => go('RemoveCustomEngine', path)              as Promise<void>,
  getDownloadableEngines:   ()                 => go('GetDownloadableEngines')                as Promise<DownloadableEngine[]>,
  downloadEngine:           (engineID: string) => go('DownloadEngine', engineID)             as Promise<void>,

  // Opening deviation detection
  detectDeviation:  (gameId: string)    => go('DetectDeviation', gameId)   as Promise<DeviationResult | null>,
  getGameDeviation: (gameId: string)    => go('GetGameDeviation', gameId)  as Promise<DeviationResult | null>,
  detectDeviations: (gameIds: string[]) => go('DetectDeviations', gameIds) as Promise<DeviationResult[]>,

  // Game analysis
  analyseGame:      (gameId: string)                   => go('AnalyseGame', gameId)                  as Promise<void>,
  analyseGames:     (gameIds: string[])                => go('AnalyseGames', gameIds)                as Promise<void>,
  getGameAnalysis:  (gameId: string)                   => go('GetGameAnalysis', gameId)              as Promise<GameAnalysisResult | null>,
  cancelAnalysis:   ()                                 => go('CancelAnalysis')                       as Promise<void>,
  getQueueStatus:   ()                                 => go('GetQueueStatus')                       as Promise<AnalysisQueueUpdate>,

  // Master Game Database
  getMasterDBStatus:            ()                                      => go('GetMasterDBStatus')                              as Promise<MasterDBStatus>,
  openMasterDBFileDialog:       ()                                      => go('OpenMasterDBFileDialog')                         as Promise<string[] | null>,
  getFileSizes:                 (paths: string[])                       => go('GetFileSizes', paths)                            as Promise<number[]>,
  startMasterDBImport:          (paths: string[], replace: boolean)     => go('StartMasterDBImport', paths, replace)            as Promise<void>,
  cancelMasterDBImport:         ()                                      => go('CancelMasterDBImport')                           as Promise<void>,
  clearMasterDB:                ()                                      => go('ClearMasterDB')                                  as Promise<void>,
  getMasterDBPath:              ()                                      => go('GetMasterDBPath')                                as Promise<string>,
  getMasterDBDir:               ()                                      => go('GetMasterDBDir')                                 as Promise<string>,
  openMasterDBDirectoryDialog:  ()                                      => go('OpenMasterDBDirectoryDialog')                    as Promise<string>,
  setMasterDBStorageDir:        (dir: string)                          => go('SetMasterDBStorageDir', dir)                     as Promise<void>,
  getMasterPositionStats:       (fen: string)                           => go('GetMasterPositionStats', fen)                    as Promise<MasterMoveStat[]>,
  getMasterGamesAtPosition:     (fen: string, limit: number)            => go('GetMasterGamesAtPosition', fen, limit)           as Promise<MasterGameSummary[]>,
  getMasterGamePGN:             (gameId: number)                        => go('GetMasterGamePGN', gameId)                       as Promise<string>,
  getMasterGameCount:           ()                                      => go('GetMasterGameCount')                             as Promise<number>,

  // Personal position index (Explorer panel — My Games tab)
  getPersonalPositionStats:     (fen: string, filters: PersonalPositionFilters)              => go('GetPersonalPositionStats', fen, filters)       as Promise<PersonalMoveStat[]>,
  getPersonalGamesAtPosition:   (fen: string, limit: number, filters: PersonalPositionFilters) => go('GetPersonalGamesAtPosition', fen, limit, filters) as Promise<PersonalGameSummary[]>,
  getPersonalIndexingStatus:    ()                                      => go('GetPersonalIndexingStatus')                      as Promise<IndexingStatus>,
  reindexPersonalGames:         ()                                      => go('ReindexPersonalGames')                          as Promise<void>,
  getPlayerSuggestions:         (prefix: string)                        => go('GetPlayerSuggestions', prefix)                  as Promise<string[]>,
  getIdentityNames:             ()                                      => go('GetIdentityNames')                              as Promise<string[]>,

  // Opening info (Statistics/Reports drill-down)
  getOpeningInfo:      (eco: string, name: string) => go('GetOpeningInfo', eco, name)  as Promise<OpeningInfo>,
  getOpeningInfoByECO: (eco: string)               => go('GetOpeningInfoByECO', eco)   as Promise<OpeningInfo>,

  // Opening drill / SRS (Epic 4.1)
  getDrillSession:    (scope: DrillScope)                              => go('GetDrillSession', scope)                        as Promise<DrillCard[]>,
  getDrillCount:      (scope: DrillScope)                              => go('GetDrillCount', scope)                          as Promise<number>,
  recordDrillResult:  (moveIds: string[], correct: boolean, playedUci?: string) => go('RecordDrillResult', moveIds, correct, playedUci ?? '') as Promise<void>,
  resetDrillScope:    (scope: DrillScope)                              => go('ResetDrillScope', scope)                        as Promise<void>,
  getDrillSummary:    (since: string)                                  => go('GetDrillSummary', since)                        as Promise<DrillSummary>,
  getRepertoireHeatmap: (repertoireId: string)                        => go('GetRepertoireHeatmap', repertoireId)             as Promise<HeatmapEntry[]>,

  // Platform
  getPlatform: () => go('GetPlatform') as Promise<string>,

  // Player statistics (Epic 5.1)
  getPlayerStats:            (filters: StatsFilters) => go('GetPlayerStats', filters)            as Promise<PlayerStats | null>,
  getPlayerAnalysisStats:    (filters: StatsFilters) => go('GetPlayerAnalysisStats', filters)    as Promise<PlayerAnalysisStats | null>,
  getPlayerVariationStats:   (filters: StatsFilters) => go('GetPlayerVariationStats', filters)   as Promise<OpeningRow[]>,
  getPlayerOpeningTree:      (filters: StatsFilters) => go('GetPlayerOpeningTree', filters)      as Promise<OpeningTreeNode[]>,
  getMoveTreeStats:          (fen: string, filters: StatsFilters, playerSide: string) => go('GetMoveTreeStats', fen, filters, playerSide) as Promise<PersonalMoveStat[]>,

  // Opponent report (Epic 5.2)
  getPlayerNames:              (prefix: string)         => go('GetPlayerNames', prefix)              as Promise<string[]>,
  getDeviationPositions:       (playerNames: string[])  => go('GetDeviationPositions', playerNames)  as Promise<DeviationRow[]>,
  getRepertoireDeviations:     (playerNames: string[])  => go('GetRepertoireDeviations', playerNames) as Promise<RepertoireDeviationRow[]>,
  getExportOpponentReport:     (playerNames: string[])  => go('ExportOpponentReport', playerNames)   as Promise<string>,
  analyzeOpponentGames:        (playerNames: string[])  => go('AnalyzeOpponentGames', playerNames)   as Promise<number>,

  // Updater / setup wizard (Epic 10)
  openURL:           (url: string)  => go('OpenURL', url)           as Promise<void>,
  isSetupComplete:   ()             => go('IsSetupComplete')         as Promise<boolean>,
  markSetupComplete: ()             => go('MarkSetupComplete')       as Promise<void>,

  // Personal Tactics / SRS puzzles (Epic 6.3)
  extractPuzzles:       (gameId: string)                       => go('ExtractPuzzles', gameId)                         as Promise<void>,
  extractAllPuzzles:    ()                                     => go('ExtractAllPuzzles')                              as Promise<void>,
  getPuzzleSession:     (limit: number, filters: PuzzleFilters) => go('GetPuzzleSession', limit, filters)              as Promise<PersonalPuzzle[]>,
  recordPuzzleResult:   (puzzleId: string, correct: boolean)   => go('RecordPuzzleResult', puzzleId, correct)          as Promise<void>,
  getPuzzleSummary:     (since: string)                        => go('GetPuzzleSummary', since)                        as Promise<PuzzleSummary>,
  getPuzzleCount:       ()                                     => go('GetPuzzleCount')                                 as Promise<number>,
  getTacticsLobbyStats: (filters: PuzzleFilters)               => go('GetTacticsLobbyStats', filters)                  as Promise<TacticsLobbyStats>,
  getPuzzleHistory:     (limit: number, offset: number)        => go('GetPuzzleHistory', limit, offset)                as Promise<PuzzleHistoryEntry[]>,

  getGtmGame:      (gameId: string) => go('GetGTMGame', gameId) as Promise<GTMGame>,
  recordGtmResult: (gameId: string, colour: string, pointsEarned: number, maxPoints: number, moveCount: number, analysed: boolean) => go('RecordGTMResult', gameId, colour, pointsEarned, maxPoints, moveCount, analysed) as Promise<GTMRating>,
  getGtmRating:    () => go('GetGTMRating') as Promise<GTMRating>,

  // Lichess OAuth
  lichessOAuthConnect:    ()                                 => go('LichessOAuthConnect')                           as Promise<void>,
  lichessOAuthCancel:     ()                                 => go('LichessOAuthCancel')                            as Promise<void>,
  lichessOAuthDisconnect: ()                                 => go('LichessOAuthDisconnect')                        as Promise<void>,
  lichessOAuthStatus:     ()                                 => go('LichessOAuthStatus')                            as Promise<string>,

  // Lichess Studies
  fetchLichessStudyMeta:  (studyId: string)                  => go('FetchLichessStudyMeta', studyId)               as Promise<StudyMeta>,
  importLichessStudy:     (req: ImportStudyRequest)          => go('ImportLichessStudy', req)                      as Promise<ImportStudyResult>,
  listLichessStudies:     ()                                 => go('ListLichessStudies')                           as Promise<LichessStudySummary[]>,
}

# Changelog

All notable changes to Masterboard are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.5] - 2026-04-24
### Fixed
- Various Mac usability fixes, especially Engine downloads and integration

## [0.6.3] - 2026-04-21
### Fixed
- Mac startup fix

## [0.6.2] - 2026-04-21
### Fixed
- Installer build fixes

## [0.6.1] - 2026-04-21
### Fixed
- Indentation in the Repertoire builder
- Assorted QoL changes

## [0.6.0] - 2026-04-20

### Added
- **Guess the Move** — new training mode: load any saved game, play through it as one side, score your moves against the engine's evaluation, and track an Elo-style rating that improves across sessions
- **Sound effects** — move, capture, and game-event sounds; toggle in Settings → General
- **Piece sets** — choose from five piece sets in Settings → Board Appearance: Cburnett (default), Merida, Alpha, California, and Staunty; piece previews shown in the selector
- **Lichess Studies import** — import any public Lichess Study directly into an opening repertoire; two-step configure → preview flow before importing
- **Lichess OAuth** — connect your Lichess account via OAuth in Settings → Connected Accounts (required for private study import)

### Fixed
- Opening deviation cache now clears correctly after importing a Polyglot book
- Accuracy calculation corrected for promotions and edge cases
- Consecutive variations in imported PGN now parse into the correct tree position

## [0.5.1] - 2026-04-15

### Added
- Startup splash screen: animated Masterboard logo displayed for a minimum of 1750 ms on launch and until the app is ready; enabled by default
- Settings → General: **Show splash screen on startup** toggle

## [0.5.0] - 2026-04-13

### Added
- Personal Statistics Dashboard (`/statistics`): W/D/L breakdown by colour, time control, and opening; 5-game rolling accuracy trend chart; blunder position gallery with FEN thumbnails; blunder heatmap board visualisation; luck rate and opportunism rate; all figures filterable by folder or collection
- Personal Tactics (`/tactics`): blunder (`??`) and mistake (`?`) positions from batch-analysed games extracted into a personal puzzle pool; FSRS v4 spaced repetition scheduling per puzzle; 10-puzzle sessions with correct/incorrect feedback and solution display; end-of-session summary

## [0.4.0] - 2026-04-12

### Added
- Opponent Preparation Report (`/reports`): W/D/L by colour; strongest lines with frequency and result rate; deviations tier showing positions where the opponent went off their own established book; export as PGN; bulk analysis of all games against a specific opponent
- Theory diversion detection: detects the exact move where a player deviated from their studied repertoire; visible when stepping through games on the Home page and in Reports
- Repertoire tab in Explorer panel: shows prepared moves at the current position across all active repertoires; available on the Home page, Repertoire Builder, and Reports view
- Polyglot book support: import `.bin` Polyglot opening books into any repertoire; per-move weight editing; export any repertoire as a `.bin` file for use with UCI engines

## [0.3.0] - 2026-04-11

### Added
- FSRS scheduler: replaced the binary interval-doubling scheme with the open-source FSRS v4 algorithm; each move tracks stability, difficulty, elapsed days, and review state
- Repertoire comments during drill: comments and NAG symbols attached to a move are shown in the feedback strip immediately after a correct or incorrect answer
- "Review All" mode: walks the entire repertoire in DFS order regardless of SRS due dates — for pre-tournament run-throughs
- End-of-session summary: moves reviewed, percentage correct, and cards graduated
- Coverage heatmap: each move in the Repertoire Tree panel displays a colour-coded dot based on FSRS retrievability
- Branch training: right-click any move in the Repertoire Tree panel → **Train branch** scopes a drill session to that subtree

## [0.2.0] - 2026-04-07

### Added
- Automated batch game analysis: engine runs at depth 18 on every position, classifies moves using the Lichess winning-chances model, inserts best-move variations into the game tree, and computes per-player accuracy (%) and ACPL
- Analysis panel: SVG eval graph across the full game, per-player accuracy and ACPL, inaccuracy/mistake/blunder counts
- Master game database: import any PGN collection as a local position index; background import with live progress bar
- Explorer panel: Master DB tab shows move popularity, W/D/L%, and average Elo from master games; My Games tab queries your personal collection
- Personal position index: games indexed incrementally at import time; re-index on demand from Settings
- Opening repertoire drills: SRS core loop with auto-play opponent moves, correct/incorrect feedback, per-move interval tracking

## [0.1.0] - 2026-04-03

### Added
- Resizable columns on the Games page
- Board editor ("Edit Position…") for setting up arbitrary positions
- App configuration panel and persistent user settings
- Multi-PV display with per-line scores in the analysis panel

## [0.0.3] - 2026-04-01

### Added
- Stockfish UCI engine integration: backend engine manager and engine panel UI
- Opening repertoire builder: create repertoires, import via PGN, visual move tree with annotations
- ECO auto-classification of imported games; live ECO display in the Notation panel

### Fixed
- Engine communication stability

## [0.0.2] - 2026-03-30

### Added
- Chess.com and Lichess game import (by username, date range, time control)
- Folder hierarchy and collections for game organisation
- Deduplication on import (content hash prevents re-importing the same game)

## [0.0.1] - 2026-03-28

### Added
- Initial application: Go + Wails v2 + React/TypeScript foundation
- SQLite game database with PGN import and export
- Home page with full annotation support: NAG symbols, free-text comments, board arrows and square highlights
- Games library page: filter by player/result/source, bulk select and delete
- OTB game recording page

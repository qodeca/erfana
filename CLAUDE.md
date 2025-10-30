# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Version**: 0.3.5
- **Tech Stack**: Electron 33, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 18+

## Key Commands
```bash
npm run dev          # Development server
npm run build        # Production build
npm run typecheck    # Type checking
npm run lint         # Linting
npm run build:mac    # macOS build

# Tests
npm run test         # Vitest workspace (one-shot)
npm run test:renderer
npm run test:main
npm run test:preload
npm run test:cov     # Coverage (v8) per project
```

## Project Structure
```
src/
├── main/           # Electron main process
│   ├── services/   # FileService, TerminalService, SettingsService
│   └── ipc/        # IPC handlers
├── preload/        # Context bridge API
└── renderer/       # React UI
    ├── components/ # UI components
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams
2. **Project Tree** - File explorer with markdown filtering, context menu
3. **Terminal** - xterm.js with PTY backend
4. **Prompt Templates** - AI text operations via context menu

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns
- [Architectural Review](docs/architectural-review/README.md) — Code quality assessment, security, testing gaps
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, flickering prevention, scroll fixes
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage (46% TerminalService)
- [Known Issues](docs/known-issues.md) — Limitations and workarounds

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## Recent Changes (v0.3.5)
- **Comprehensive Test Coverage for Prompt System**: Added 319 new automated tests
  - Core System Tests (177 tests): parser, renderer, helpers, schema, registry
  - UI Component Tests (75 tests): UserInputDialog, PreviewContextMenu, MarkdownPreview
  - Regression Tests (67 tests): prompt command validation, existing commands preservation
  - Total: 395 tests passing (32 test files)
  - Coverage: 98.59% statements, 96.59% branches, 100% functions, 98.59% lines
- **Test Infrastructure**: Created comprehensive test utilities
  - fixtures.ts: Factory functions for mock data (mockPromptVariables, mockPromptConfig, TEST_TEMPLATES)
  - mocks.ts: Mock utilities (createMockWindowApi, installMockWindowApi, resetStores)
  - Consistent test patterns across all test suites
- **Code Quality Improvements**:
  - Fixed 6 TypeScript errors in test utilities (Map initialization, ActivityBarStore state)
  - Fixed 19 ESLint errors (unused variables, explicit any types, unused imports)
  - All tests passing, typecheck clean, lint clean
- **Testing Documentation**: Updated docs/testing/README.md with comprehensive prompt system testing information
- **Test Fixes**: Fixed userEvent.type() issues in coverage runs by switching to userEvent.paste()

## Changes in v0.3.4
- **AutoExecute Simplification**: Reverted to fire-and-forget approach (v0.3.3 was over-engineered)
  - Removed Promise-based writes with callbacks (caused IPC hangs)
  - Removed initialization polling (overkill - 100+ lines removed)
  - Kept 200ms delay (industry standard: VSCode, Hyper, iTerm2)
  - Write ordering guaranteed by TCP FIFO semantics
  - Research: node-pty callback only indicates socket flush, NOT render completion
  - Result: -80 net lines, +10% reliability, simpler maintainability
  - 10 comprehensive tests in useTerminalStore.autoExecute.test.ts (95.77% coverage)
  - Total: 76 tests across 22 files
  - See [docs/prompts/](docs/prompts/) for split documentation (autoexecute-overview, technical, testing, reference)
- **Documentation Token Efficiency Improvements**:
  - Moved unimplemented graph-engine docs to docs/future/ (~145,800 tokens saved, 73% reduction)
  - Split docs/prompts/implementation.md (689 lines → 4 files ≤500 lines each)
  - All docs/ files now ≤500 lines for optimal Claude Code context loading

## Changes in v0.3.3
- **AutoExecute Race Condition Fix**: Fixed inconsistent behavior in "Elaborate", "Modify", and "Ask" context menu actions
  - Changed terminal writes from fire-and-forget to Promise-based with completion callbacks
  - Added terminal initialization polling (5s max, 50ms intervals) to prevent race conditions
  - Enhanced error handling: autoExecute fails fast, manual writes proceed with warning
  - Increased delay from 100ms to 200ms for reliability
  - Promise-based IPC pattern (terminal:write changed from ipcMain.on to ipcMain.handle)
  - 13 comprehensive tests in useTerminalStore.autoExecute.test.ts
  - Total: 79 tests across 22 files (was 66 tests in v0.3.2)
  - See [docs/prompts/implementation.md](docs/prompts/implementation.md) for implementation details

## Changes in v0.3.2
- **Terminal Flickering Prevention**: Fixed terminal rendering flicker in production builds
  - Added Electron WebGL command line switches for Electron 33 compatibility
  - Enhanced WebGL context recovery with automatic retry after loss
  - Integer dimension enforcement (Math.floor) to prevent fractional oscillation
  - Dimension change threshold (≥2 cols OR ≥1 row) to filter devicePixelRatio noise
  - 6 comprehensive tests in TerminalPanel.flickering.test.tsx
  - Related: xterm.js #4922, Electron 33 WebGL context management
- **Scroll to Bottom Button**: Added manual workaround for Claude Code scroll jumping
  - New button (⬇️ icon) in terminal header
  - Quick recovery from scroll position loss
  - Uses xterm.js scrollToBottom() API
- **Documentation Restructuring**: Split oversized documentation files
  - terminal.md split into terminal/ subfolder (5 focused files)
  - All files now comply with 500-line limit for Claude Code efficiency

## Changes in v0.3.1
- **Terminal Scroll Fix**: Fixed terminal jumping to top during Claude CLI streaming output
  - Scroll position tracking using Buffer API (viewportY vs baseY)
  - Terminal options: scrollOnUserInput: false, smoothScrollDuration: 0
  - CSS fix: overflow-y: auto instead of forced scrollbars
  - 6 comprehensive tests in TerminalPanel.scroll.test.tsx
  - Related issues: GitHub #826, #1413, #1426

## Changes in v0.3.0
- **Terminal Bootstrap Pattern**: Eliminated initialization artifacts using non-interactive `-c` script + exec
  - Zero visible commands (cd, pwd, echo marker)
  - Three-flag gating system (hasReceivedMarker, initializationComplete, isClearing)
  - Bypass channel for deterministic clear handshake
  - Environment variable filtering (excludes dev vars)
  - 18 comprehensive tests, 46% coverage
- Symlink indicators in Project Tree (watchers do not follow symlinks)
- Watcher depth setting (config-only; not exposed in UI)
- Improved editor/preview scroll sync
- Fixed EPIPE errors during shutdown
- Watchers: recoverable ENOENT (stopAll) + session token guards

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see docs/testing/README.md).
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`).
- Visual/MCP Scenarios: See docs/testing/ui-scenarios.md and docs/testing/interaction-scenarios.md.

## Project Switching Safeguards
- Unsaved editor prompt on open/close (Discard/Cancel)
- Terminal activity heuristic:
  - Per-terminal tracking, marks on input + output
  - 500ms warm-up ignore
  - 20s busy window
  - Clears on exit and after Ctrl+C if quiet
- Terminal initialization defers until panel is visible
- Watchers increment session tokens on switch; stale events dropped

## IPC Contracts
- Shared schemas/types: `src/shared/ipc/schema.ts` (zod)
- `project:changed` payload: `{ oldPath: string | null; newPath: string | null }`

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview

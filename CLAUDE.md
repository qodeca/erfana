# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Version**: 0.3.0
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
- [Architectural Review](docs/architectural-review.md) — Code quality assessment, security, testing gaps
- [Terminal](docs/terminal.md) — Bootstrap pattern, integration, clean initialization
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync
- [File Watching](docs/file-watching.md) — Auto-refresh, recoverable ENOENT, session tokens
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

## Recent Changes (v0.3.0)
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

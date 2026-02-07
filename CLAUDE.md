# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub)
- **Version**: 0.7.2
- **Tech Stack**: Electron 39, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 18+ (Electron 39 bundles Node.js 22.20.0)

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
npm run test:e2e     # Playwright E2E tests
```

## Project Structure
```
src/
├── main/           # Electron main process
│   ├── services/   # Core: FileService, TerminalService, ProjectService, LoggingService; Git: GitStatusService, GitWatcherService, GitPollingService; Watchers: DirectoryWatcherService, FileWatcherService; Settings: SettingsService, ProjectSettingsService, GlobalSettingsService; Media: ScreenshotService, CameraService, PdfService, DocxService; Multi-instance: ProjectLockService, ExternalFileService; Subdirs: import/, watcher/
│   └── ipc/        # IPC handlers
├── preload/        # Context bridge API
├── shared/         # Shared code (errors.ts, constants.ts, ipc schemas)
└── renderer/       # React UI
    ├── components/ # UI components (Tabs/, Dialog/, ContextMenu/, etc.)
    ├── context/    # React contexts (ProjectManagementContext, TerminalPortalContext)
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams (zoom, pan, full-screen viewer), YAML frontmatter rendering, preserve line breaks option, unified in-file search (Cmd/Ctrl+F), context menu with AI prompts
2. **Project Tree** - File explorer with drag-drop reorganization, external file drop (move/copy/import), markdown filtering, context menu, real-time git status indicators with polling fallback, manual refresh button (Cmd/Ctrl+Alt+R)
3. **Terminal** - xterm.js with PTY backend, clipboard support, file links, scroll recovery, auto-opens on project load, drag-drop file paths, screenshot capture (macOS: screen/window/area selection with path pasted to terminal), camera photo capture (cross-platform: captures photo from webcam with path pasted to terminal)
4. **Prompt Templates** - AI text operations via context menu (Elaborate, Modify, Ask, Visualize, diagram chat); Visualize generates Mermaid diagrams from selected text with dropdown for 22 diagram types
5. **Project Settings** - Per-project configuration via `.erfana/settings.json` (watcher ignore, tree visibility)
6. **PDF Export** - Export markdown to print-optimized PDF with vector Mermaid diagrams, A4 page size, print-friendly styling
7. **DOCX Export** - Export markdown to Word format with Mermaid diagrams as high-resolution PNG images
8. **Settings Overlay** - Full-screen settings UI accessed via gear icon in activity bar, with focus trapping and keyboard navigation (Escape to close)
9. **Quit Confirmation** - Prompts before quitting with unsaved changes or active terminal sessions
10. **Multi-Instance** - Multiple independent instances with file-based project locking, duplicate opens focus existing window
11. **Image Preview** - Viewer for PNG, JPG, GIF, WebP, SVG, BMP, ICO with zoom, pan, fit controls, keyboard shortcuts (arrow keys, +/-, Home, F for fullscreen), and full-screen mode

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Build](docs/build/README.md) — Build configuration, electron-builder, ASAR, fuses, troubleshooting
- [Security](docs/security.md) — Electron 39 security hardening, fuses, sandboxing, trade-offs
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, scroll fixes, clipboard, drag-drop paths, screenshot capture (macOS), camera capture (cross-platform)
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync, Mermaid diagrams
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens, spec 016 behavioral contract
- [Logging](docs/logging.md) — Logging layer, log levels, file rotation, configuration
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [API Services](docs/api-services.md) — Service APIs (Terminal, File, Settings, Watchers)
- [API Services – Features](docs/api-services-features.md) — Feature service APIs (Git, Camera, ProjectLock, ExternalFile)
- [UI Components](docs/ui-components.md) — React component architecture, activity bars, panels
- [Prompt Templates](docs/prompts/README.md) — AI prompt system, AutoExecute, template syntax
- [Changelog](docs/CHANGELOG.md) — Version history (v0.3.x onwards)
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI

## Feature specifications

Feature specifications live in `specs/`. Check registry before implementing new features.

### Active specs

| ID | Name | Tier | Status | Path |
|----|------|------|--------|------|
| 004 | Graph engine foundation | T4 | draft | `specs/spec-t4-004-graph-foundation` |
| 005 | Vector search & hybrid retrieval | T3 | draft | `specs/spec-t3-005-vector-search` |
| 006 | Knowledge graph & entities | T3 | draft | `specs/spec-t3-006-knowledge-graph` |
| 007 | Temporal queries & timeline | T3 | draft | `specs/spec-t3-007-temporal-queries` |
| 008 | Graph engine polish & maintenance | T3 | draft | `specs/spec-t3-008-graph-polish` |
| 009 | Media import with transcription | T4 | draft | `specs/spec-t4-009-media-import-transcription` |
| 013 | Multi-CLI tool prompt optimization | T3 | draft | `specs/spec-t3-013-multi-cli-tool-prompt-optimization` |
| 016 | Project Tree refresh specification | T3 | implemented | `specs/spec-t3-016-project-tree-refresh` |

**Registry**: `specs/registry.json`

**Before implementing a feature**: Read the spec overview (`requirements/01-overview.md`), requirements (`requirements/02-requirements.md`), and acceptance criteria (`requirements/03-acceptance.md`).

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## UI Style Guide (MANDATORY)

**Before implementing ANY UI changes**: Read [docs/ui-style-guide.md](docs/ui-style-guide.md) and use design tokens from `src/renderer/src/styles/design-tokens.css`.

**Key rules**: Use `var(--color-*)`, `var(--space-*)`, `var(--text-*)` tokens. No hardcoded values. `border-radius: 0` always.

## Changelog

For detailed changelog, see [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see [docs/testing/README.md](docs/testing/README.md))
- E2E: Playwright with Electron (see [docs/testing/e2e-testing.md](docs/testing/e2e-testing.md))
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`)

## Project Switching Safeguards
- Unsaved editor prompt on open/close (Discard/Cancel)
- Terminal activity heuristic:
  - Per-terminal tracking, marks on input + output
  - 500ms warm-up ignore
  - 20s busy window
  - Clears on exit and after Ctrl+C if quiet
- Terminal initialization defers until panel is visible
- Watchers increment session tokens on switch; stale events dropped
- Project settings loaded and validated before project opens (invalid settings block load)

## IPC Contracts
- Shared schemas/types: `src/shared/ipc/*.ts` (zod schemas)
- `project:changed` payload: `{ oldPath: string | null; newPath: string | null }`

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status uses isomorphic-git (global `.gitignore` not supported)

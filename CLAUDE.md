# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub)
- **Version**: 0.6.4-zulu
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
```

## Project Structure
```
src/
├── main/           # Electron main process
│   ├── services/   # FileService, TerminalService, SettingsService, ProjectSettingsService, GlobalSettingsService, LoggingService, ProjectLockService, import/
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
2. **Project Tree** - File explorer with drag-drop reorganization, markdown filtering, context menu, real-time git status indicators with polling fallback
3. **Terminal** - xterm.js with PTY backend, clipboard support, file links, scroll recovery, auto-opens on project load
4. **Prompt Templates** - AI text operations via context menu (Elaborate, Modify, Ask, Visualize, diagram chat); Visualize generates Mermaid diagrams from selected text with dropdown for 22 diagram types
5. **Project Settings** - Per-project configuration via `.erfana/settings.json` (watcher ignore, tree visibility)
6. **PDF Export** - Export markdown to print-optimized PDF with vector Mermaid diagrams, A4 page size, print-friendly styling
7. **DOCX Export** - Export markdown to Word format with Mermaid diagrams as high-resolution PNG images
8. **Settings Overlay** - Full-screen settings UI accessed via gear icon in activity bar, with focus trapping and keyboard navigation (Escape to close)
9. **Quit Confirmation** - Prompts before quitting with unsaved changes or active terminal sessions
10. **Multi-Instance** - Multiple independent instances with file-based project locking, duplicate opens focus existing window

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Build](docs/build/README.md) — Build configuration, electron-builder, ASAR, fuses, troubleshooting
- [Security](docs/security.md) — Electron 39 security hardening, fuses, sandboxing, trade-offs
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, flickering prevention, scroll fixes, clipboard
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync, Mermaid diagrams
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens
- [Logging](docs/logging.md) — Logging layer, log levels, file rotation, configuration
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage (5612 tests, 180 files)
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [Changelog](docs/CHANGELOG.md) — Historical changelog entries (v0.3.x - v0.6.x)
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI

## Business Requirements Specifications (BRS)

Feature specifications live in `specs/business-reqs/`. Check registry before implementing new features.

| ID | Name | Tier | Status | Path |
|----|------|------|--------|------|
| BRS-001 | Unified in-file search | T3 | draft | `specs/business-reqs/brs001-unified-search/` |
| BRS-002 | Editor context menu with prompts | T3 | active | `specs/business-reqs/brs002-editor-context-menu/` |
| BRS-003 | Real-time git status refresh | T3 | active | `specs/business-reqs/brs003-realtime-git-status/` |
| BRS-004 | Graph engine foundation | T4 | draft | `specs/business-reqs/brs004-graph-foundation/` |
| BRS-005 | Vector search & hybrid retrieval | T3 | draft | `specs/business-reqs/brs005-vector-search/` |
| BRS-006 | Knowledge graph & entities | T3 | draft | `specs/business-reqs/brs006-knowledge-graph/` |
| BRS-007 | Temporal queries & timeline | T3 | draft | `specs/business-reqs/brs007-temporal-queries/` |
| BRS-008 | Graph engine polish & maintenance | T3 | draft | `specs/business-reqs/brs008-graph-polish/` |
| BRS-009 | Media import with transcription | T4 | draft | `specs/business-reqs/brs009-media-import-transcription/` |
| BRS-010 | Multiple independent instances | T4 | active | `specs/business-reqs/brs010-multi-instance/` |
| BRS-011 | Automated UI testing compatibility | T3 | draft | `specs/business-reqs/brs011-ui-test-compatibility/` |

**Registry**: `specs/business-reqs/registry.json`

**Before implementing a feature**: Read the BRS overview (01-overview.md), requirements (02-requirements.md), and acceptance criteria (03-acceptance.md).

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## UI Style Guide (MANDATORY)

**Before implementing ANY UI changes, you MUST:**

1. **Read the style guide**: [docs/ui-style-guide.md](docs/ui-style-guide.md)
2. **Use design tokens**: All CSS values come from `src/renderer/src/styles/design-tokens.css`

### Rules (Non-Negotiable)

| Category | Rule | Example |
|----------|------|---------|
| Colors | Use `var(--color-*)` tokens | `color: var(--color-text-primary)` |
| Spacing | Use `var(--space-*)` tokens | `padding: var(--space-6)` (12px) |
| Typography | Use `var(--text-*)` and `var(--font-*)` | `font-size: var(--text-base)` (13px) |
| Borders | `border-radius: 0` always | Exception: `50%` for circles only |
| Transitions | Use `var(--transition-normal)` | `transition: var(--transition-normal)` (0.15s) |
| Z-Index | Use `var(--z-*)` tokens | `z-index: var(--z-modal)` |
| Shadows | Use `var(--shadow-*)` tokens | `box-shadow: var(--shadow-md)` |

### Quick Reference - Common Tokens

```css
/* Colors (Qodeca Brand) */
--color-text-primary       /* #cccccc - main text */
--color-text-secondary     /* #858585 - muted text */
--color-bg-primary         /* #161312 - Smoky Black (main background) */
--color-bg-secondary       /* #2d2d30 - panels */
--color-border-default     /* #3c3c3c - borders */
--color-accent-primary     /* #A0A8FF - Qodeca Violet */
--color-accent-secondary   /* #E3E829 - Qodeca Lime */

/* Spacing (4px grid) */
--space-4   /* 8px */
--space-6   /* 12px */
--space-8   /* 16px */
--space-12  /* 24px */

/* Typography */
--text-base /* 13px - default */
--text-sm   /* 11px - small */
```

### Checklist Before Committing UI Changes

- [ ] All colors use design tokens (no hardcoded hex values)
- [ ] All spacing uses design tokens (no arbitrary px values)
- [ ] All fonts use design tokens
- [ ] No rounded corners (border-radius: 0)
- [ ] Transitions use tokens
- [ ] Focus states are visible (accessibility)

## Recent Changes

For detailed changelog, see [docs/CHANGELOG.md](docs/CHANGELOG.md).

**v0.6.4-zulu highlights**:
- E2E testing infrastructure with 138 testids, Playwright integration
- MarkdownEditorPanel modular refactoring (SOLID principles)
- Multi-instance support with project locking
- Editor context menu with AI prompts
- Real-time git status with polling fallback
- Unified in-file search (Cmd/Ctrl+F)
- PDF/DOCX export, settings overlay, logging layer

## Historical Changes

For detailed changelog entries from v0.3.0 through v0.5.4, see [docs/CHANGELOG.md](docs/CHANGELOG.md).

**Recent versions summary**:
- v0.5.4 - Terminal scroll scheduler, flicker-free recovery, git status indicators, Mermaid toolbar
- v0.5.0-0.5.2 - Mermaid diagram viewer (full-screen, zoom, theming, direction controls), terminal file links
- v0.4.0-0.4.7 - Terminal clipboard, watcher performance, import system, tabs, scroll recovery
- v0.3.x - Terminal bootstrap, drag-drop, dialog system, prompt templates, test coverage

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see [docs/testing/README.md](docs/testing/README.md))
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`)
- **Current**: 5612 tests passing (180 test files)

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

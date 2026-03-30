# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub)
- **Version**: 0.9.0
- **Tech Stack**: Electron 39, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Build Toolchain**: electron-vite 5, Vite 6, vitest 3
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 24+ (development), Electron 39 bundles Node.js 22.20.0

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
npm run test:e2e     # Playwright E2E tests (functional only)
npm run test:e2e:visual           # Visual regression tests
npm run test:e2e:update-screenshots  # Update visual baselines
```

## Project Structure
```
e2e/                # Playwright E2E tests (POM pattern)
├── fixtures/       # Composed Playwright fixtures (app, window, POM instances)
├── pages/          # Page Object Model classes (TerminalPage, MonacoPage, MermaidPage, ProjectTreePage, KeyboardHelper)
└── utils/          # Shared helpers (helpers.ts backward-compat adapter), locators (byTestId)
resources/
└── tessdata/       # Pre-bundled Tesseract OCR language data (eng.traineddata)
src/
├── main/           # Electron main process
│   ├── services/   # Core: FileService, TerminalService, ProjectService, LoggingService; Git: GitStatusService, GitWatcherService, GitPollingService; Watchers: DirectoryWatcherService, FileWatcherService; Settings: SettingsService, ProjectSettingsService, GlobalSettingsService; Media: ScreenshotService, CameraService, DocxService, TranscriptionService, LocalWhisperService, WhisperModelManager, AudioMetadataService, AudioExtractionService, ApiKeyService; Import: LiteParseConverter, DependencyDetector; Multi-instance: ProjectLockService, ExternalFileService; Subdirs: import/, watcher/
│   ├── ipc/        # IPC handlers
│   └── utils/      # PauseController (pause/resume with safety timeout)
├── preload/        # Context bridge API
├── shared/         # Shared code (errors.ts, constants.ts, ipc schemas)
└── renderer/       # React UI
    ├── components/ # UI components (Tabs/, Dialog/, ContextMenu/, Transcription/, DocumentImport/, etc.)
    ├── context/    # React contexts (ProjectManagementContext, TerminalPortalContext)
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams (zoom, pan, full-screen viewer), YAML frontmatter rendering, preserve line breaks option, unified in-file search (Cmd/Ctrl+F), context menu with AI prompts
2. **Project Tree** - File explorer with drag-drop reorganization, external file drop (move/copy/import), markdown filtering, context menu, real-time git status indicators with polling fallback, manual refresh button (Cmd/Ctrl+Alt+R)
3. **Terminal** - xterm.js with PTY backend, clipboard support, file links (multi-line: xterm-wrap joining + CLI-wrap joining for tool output), scroll recovery, auto-opens on project load, drag-drop file paths, bracketed paste mode for safe multi-line input, screenshot capture (macOS: screen/window/area selection with path pasted to terminal), camera photo capture (cross-platform: captures photo from webcam with path pasted to terminal)
4. **Prompt Templates** - AI text operations via context menu (Explain, Modify, Ask, Visualize, diagram chat); Visualize generates Mermaid diagrams from selected text with dropdown for 22 diagram types
5. **Project Settings** - Per-project configuration via `.erfana/settings.json` (watcher ignore, tree visibility)
6. **PDF Export** - Export markdown to print-optimized PDF with vector Mermaid diagrams, A4 page size, print-friendly styling
7. **DOCX Export** - Export markdown to Word format with Mermaid diagrams as high-resolution PNG images
8. **Document Import** – Import 50+ document formats via LiteParse (PDF, Office, images) with local OCR (Tesseract.js), spatial text extraction, YAML frontmatter, optional page screenshots; DocumentImportDialog with OCR toggle, language selection (31 languages), screenshot generation, DPI configuration; session-persistent options; indeterminate progress with phase text and OCR warnings; dependency-missing modal for LibreOffice/ImageMagick; batch drag-drop filtering; two-phase extension registration; DependencyDetector for runtime tool detection; IPC layer with Zod-validated schemas, progress streaming, cancellation, and preload bridge (`api.import.*`)
9. **Settings Overlay** - Full-screen settings UI accessed via gear icon in activity bar, with focus trapping and keyboard navigation (Escape to close), logs folder path display with native file manager open
10. **Quit Confirmation** - Prompts before quitting with unsaved changes or active terminal sessions
11. **Multi-Instance** - Multiple independent instances with file-based project locking, duplicate opens focus existing window
12. **Image Preview** - Viewer for PNG, JPG, GIF, WebP, SVG, BMP, ICO with zoom, pan, fit controls, keyboard shortcuts (arrow keys, +/-, Home, F for fullscreen), and full-screen mode
13. **Media Transcription** - Import audio (MP3, WAV, M4A, OGG, FLAC) and video (MP4, MOV, AVI, MKV, WebM, FLV, WMV) files with dual backend transcription: OpenAI API (GPT-4o-transcribe primary, Whisper-1 fallback) or local whisper.cpp (offline, model selection: tiny/base/small/medium/large with download management), video audio extraction via ffmpeg (fluent-ffmpeg), file chunking for long recordings (>8 min), TranscriptionDialog with language selection (persists within session) and progress, pre-validation before dialog opens, batch import rejects media with toast, API key management via Electron safeStorage, video-specific frontmatter (type, resolution, video_codec), dynamic `transcription_backend` frontmatter, post-transcription auto-open of transcript file and organize-import prompt

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Build](docs/build/README.md) — Build configuration, electron-builder, ASAR, fuses, troubleshooting
- [Security](docs/security.md) — Electron 39 security hardening, fuses, sandboxing, trade-offs
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, scroll fixes, clipboard, file links (CLI-wrap joining), drag-drop paths, screenshot capture (macOS), camera capture (cross-platform)
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync, Mermaid diagrams
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens, PauseController auto-resume
- [Logging](docs/logging.md) — Logging layer, log levels, file rotation, configuration
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, E2E (POM), visual regression, coverage
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [API Services](docs/api-services.md) — Service APIs (Terminal, File, Settings, Watchers)
- [API Services – Features](docs/api-services-features.md) — Feature service APIs (GitWatcher, GitPolling, Camera, ProjectLock, ExternalFile, LiteParse, DependencyDetector, DOCX, Transcription, LocalWhisper, WhisperModelManager, AudioMetadata, AudioExtraction, ApiKey)
- [UI Components](docs/ui-components.md) — React component architecture, activity bars, panels
- [Prompt Templates](docs/prompts/README.md) — AI prompt system, AutoExecute, template syntax
- [Settings](docs/settings.md) — Settings overlay sections (Editor, Git, Logging, Transcription)
- [Changelog](docs/CHANGELOG.md) — Version history (v0.6.0 onwards; earlier in [archive](docs/archive/changelog-v03-v05.md))
- [Development Tasks](docs/development-tasks.md) — How-to guides: add IPC channels, panels, services, import converters, prompt templates
- [Technical Debt](docs/technical-debt.md) — Known debt items and improvement opportunities
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI
- [Source Grounding](docs/future/source-grounding/README.md) — NotebookLM-style grounding research, gap analysis, strategy, implementation roadmap
- [Roadmap](ROADMAP.md) — Implementation order for active specs with dependency analysis

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
| 009 | Media import with transcription | T4 | archived | `specs/archived/spec-t4-009-media-import-transcription` |
| 013 | Multi-CLI tool prompt optimization | T3 | draft | `specs/spec-t3-013-multi-cli-tool-prompt-optimization` |
| 016 | Project Tree refresh specification | T3 | archived | `specs/archived/spec-t3-016-project-tree-refresh` |
| 017 | Test ID coverage and accessibility selectors | T2 | archived | `specs/archived/spec-t2-017-test-id-accessibility` |
| 018 | E2E infrastructure overhaul | T3 | archived | `specs/archived/spec-t3-018-e2e-infrastructure` |
| 019 | Visual regression and CI resilience | T2 | archived | `specs/archived/spec-t2-019-visual-regression-ci` |
| 020 | Google Drive link integration | T4 | draft | `specs/spec-t4-020-google-drive-links` |
| 021 | LiteParse document import | T3 | archived | `specs/archived/spec-t3-021-liteparse-document-import` |

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
- E2E: Playwright with Electron, Page Object Model pattern (see [docs/testing/e2e-testing.md](docs/testing/e2e-testing.md))
  - POM classes in `e2e/pages/`: TerminalPage, MonacoPage, MermaidPage, ProjectTreePage, KeyboardHelper
  - Composed fixtures in `e2e/fixtures/index.ts` – use `test` export with POM fixtures (worker-scoped userDataDir, test-scoped app/window)
  - Project fixtures: `testProject` (isolated temp dir with seed files), `withSettings` (writes `.erfana/settings.json`), `withOpenFile` (opens file in editor, waits for Monaco readiness)
  - App-with-project fixtures: `appWithTestProject` / `windowWithTestProject` – launch Electron with testProject path
  - Backward-compatible adapter in `e2e/utils/helpers.ts` (WeakMap caching delegates to POM instances)
  - Condition-based waits preferred over `waitForTimeout` – use `waitForPrompt()`, `waitForOutput()`, Playwright auto-waiting
  - Wait helpers in `e2e/utils/wait-helpers.ts`: `waitForIpcComplete` (race-safe IPC wait helper)
  - Shared locators in `e2e/utils/locators.ts`: `byTestId`, `byDynamicTestId`, `waitForTestId`, `waitForTestIdHidden`
- Visual regression: Playwright `toHaveScreenshot()` for 5 UI states (welcome, editor, terminal, settings, confirm dialog); baselines in `e2e/screenshots/` with platform suffix; `--project=visual` in Playwright config
- E2E env vars: Some tests require API keys via `.env` file (see `.env.example`); tests skip gracefully if not set
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
- Document import channels (`src/shared/ipc/import-channels.ts`, `import-schema.ts`):
  - `import:document` – Start document import with options and progress streaming
  - `import:documentProgress` – Progress events (main → renderer push)
  - `import:documentCancel` – Cancel active import
  - `import:getDocumentExtensions` – Query available document extensions
  - `import:dependenciesReady` – Dependency detection complete (main → renderer push)

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status uses isomorphic-git (global `.gitignore` not supported)

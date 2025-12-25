# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub)
- **Version**: 0.6.4-beta
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
│   ├── services/   # FileService, TerminalService, SettingsService, ProjectSettingsService, GlobalSettingsService, LoggingService, import/
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
- [Testing](docs/testing/README.md) — Workspace, coverage (5049 tests, 162 files)
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
| BRS-010 | Multiple independent instances | T4 | draft | `specs/business-reqs/brs010-multi-instance/` |

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

## Recent Changes (v0.6.x)

### Editor Context Menu with AI Prompts (Dec 25, 2025)
Added context menu to Monaco editor with AI prompt actions, mirroring preview panel UX:

**Features**:
- Right-click with text selected shows custom context menu
- Prompts filtered by `area: code-editor`, `subArea: context-menu`
- "Elaborate" executes directly, "Modify" and "Ask" show input dialog
- "Copy selection" action copies text to clipboard
- Menu dismisses on Escape, click outside, or action execution

**Files Created**:
- `src/renderer/src/components/ContextMenu/EditorContextMenu.tsx` - Context menu component
- `src/renderer/src/prompts/templates/code-elaborate.md` - Elaborate prompt for code editor
- `src/renderer/src/prompts/templates/code-modify.md` - Modify prompt for code editor
- `src/renderer/src/prompts/templates/code-ask.md` - Ask prompt for code editor

**Files Modified**:
- `src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx` - onContextMenu handler
- `src/renderer/src/components/Editor/MarkdownEditorPanel.tsx` - State management for context menu

**BRS**: `specs/business-reqs/brs002-editor-context-menu/`

**Testing**: 27 new tests added (total: 5049 tests, 162 files)

Closes #73

### Real-time Git Status Refresh with Polling Fallback (Dec 22, 2025)
Implemented comprehensive git status monitoring with multi-path file watching and hybrid polling fallback:

**Features:**
- Watch all git state files: `.git/index`, `.git/HEAD`, `.git/refs/heads/`, `.git/FETCH_HEAD`, `.git/stash`
- Hybrid polling fallback (5-second default) for reliable detection on network/cloud drives
- Event coalescing (150ms window) to prevent refresh storms
- Latency reduced from ~2s to ~750ms (debounce 500->250ms, cooldown 1500->500ms)
- Auto-recovery with exponential backoff (800ms, 1600ms, 3200ms)
- User-configurable polling in Settings overlay (enable/disable, 3-10s interval)

**New Files:**
- `src/main/services/GitWatcherService.ts` - Multi-path git state watching
- `src/main/services/GitPollingService.ts` - Hybrid polling fallback
- `src/main/services/watcher/GitEventCoalescer.ts` - Event coalescing logic
- `src/main/interfaces/IGitWatcherService.ts` - Service interface
- `src/main/utils/ipcBroadcast.ts` - Centralized IPC broadcast utility
- `src/shared/ipc/git-watcher-schema.ts` - Zod schemas for IPC events
- `src/main/ipc/git-watcher-handlers.ts` - IPC handlers with path security

**Modified Files:**
- `src/shared/ipc/global-settings-schema.ts` - Added gitStatus settings section
- `src/renderer/src/stores/useGlobalSettingsStore.ts` - Added gitStatus methods
- `src/renderer/src/components/Settings/SettingsOverlay.tsx` - Added Git status settings UI
- `src/renderer/src/components/ProjectTree/constants.ts` - Reduced timing constants
- `src/renderer/src/hooks/useGitStatus.ts` - Switched to new gitWatcher API
- `src/preload/index.ts` - Added gitWatcher and gitPolling APIs
- `src/main/services/watcher/WatcherMetrics.ts` - Added polling stats

**Testing:** 151 new tests added (total: 5014 tests, 161 files)

Closes #74

### Prompt Template Optimization for Claude Code (Dec 22, 2025)
All 9 prompt templates transformed to XML-structured format for improved Claude Code compatibility:
- Added semantic XML tags: `<context>`, `<input>`, `<task>`, `<instructions>`, `<constraints>`, `<output_format>`
- Thinking triggers: "think" in elaborate.md and ask.md, "think hard" in visualize.md
- Terminal UX optimizations: character limits, no preamble instructions, bullet point formatting

**Templates Updated**: `elaborate.md`, `modify.md`, `ask.md`, `visualize.md`, `prompt.md`, `mermaid-chat.md`, `mermaid-bug-report.md`, `mermaid-change-direction.md`, `organize-import.md`

**Files Modified**: `src/renderer/src/prompts/templates/` (9 files)

Closes #72

### Auto-Open Terminal on Project Load (Dec 22, 2025)
Terminal panel now automatically opens when a project loads:
- Auto-opens on Recent Projects selection or File > Open
- Ephemeral `terminalUserClosed` state tracks manual closes
- If user closes terminal, it stays closed until next project load
- `useAutoOpenTerminal` hook integrates with `useProjectChangedEffect`

**Files Created**: `src/renderer/src/hooks/useAutoOpenTerminal.ts`

**Files Modified**: `src/renderer/src/stores/useActivityBarStore.ts`, `src/renderer/src/components/DockLayout/AppDockLayout.tsx`

**Testing**: 41 new tests added (total: 4742 tests, 156 files)

Closes #55

### Unified In-File Search (Dec 22, 2025)
Added unified search overlay (Cmd/Ctrl+F) for editor and preview panes with provider pattern:

**Features**:
- Unified search overlay activated via Cmd/Ctrl+F in editor or preview
- Provider pattern: `MonacoSearchProvider` (editor), `PreviewSearchProvider` (preview)
- SearchBar component with debounced search, case sensitivity toggle, whole word toggle
- Keyboard navigation: Enter/Shift+Enter for next/prev match, Escape to close
- Split mode support with per-pane search state
- CSS Highlight API with class-based fallback for preview highlighting

**Implementation**:
- Created `useSearchStore` Zustand store for search state management
- Implemented `SearchProvider` interface with Monaco and Preview implementations
- SearchBar component with match count display and navigation buttons
- Keyboard shortcut hook (`useSearchKeyboard`) for Cmd/Ctrl+F handling
- Monaco keybinding overrides to intercept native find dialog

**Files Created**:
- `src/renderer/src/stores/useSearchStore.ts` - Zustand search state
- `src/renderer/src/providers/search/SearchProvider.ts` - Provider interface
- `src/renderer/src/providers/search/MonacoSearchProvider.ts` - Editor search
- `src/renderer/src/providers/search/PreviewSearchProvider.ts` - Preview search
- `src/renderer/src/components/Search/SearchBar.tsx` - Search UI component
- `src/renderer/src/components/Search/SearchBar.css` - Search styling
- `src/renderer/src/hooks/useSearchKeyboard.ts` - Keyboard shortcut hook

**Files Modified**:
- `src/renderer/src/components/Editor/MarkdownEditorPanel.tsx` - Added SearchBar, provider integration
- `src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx` - Keybinding overrides for Cmd+F
- CSS files for decoration/highlight styles

**Testing**: 163 new tests added (total: 4643 tests, 153 files)

Closes #71

### MarkdownEditorPanel Refactoring (Dec 22, 2025)
Major refactoring of MarkdownEditorPanel.tsx (1365 → ~900 lines) following SOLID principles:

**Pure Logic Extraction** (`markdownEditorPanel.logic.ts`, 591 lines):
- `calculateStats` - document statistics
- `buildScrollMapEntries`, `interpolateScrollPosition` - scroll sync algorithms
- `extractFileName`, `formatTabTitle`, `isSplitMode`, `getDefaultViewMode` - utilities
- 83 comprehensive tests

**New Hooks**:
- `useAutoSave.ts` - debounced auto-save with proper React state
- `useFileWatcher.ts` - file change detection with race condition protection

**Files Created**: `markdownEditorPanel.logic.ts`, `useAutoSave.ts`, `useFileWatcher.ts` + tests

**Testing**: 110 new tests added (total: 4463 tests, 148 files)

### Quit Confirmation on Close (Dec 21, 2025)
App now quits fully on close with confirmation dialog for unsaved changes:
- All close methods (window [x], Cmd+Q, Cmd+W, dock menu) trigger full app quit
- macOS: Overrides default dock behavior to quit fully instead of staying in dock
- Combined confirmation dialog for unsaved changes AND/OR terminal activity
- Dialog buttons: "Quit" / "Cancel" (no Save option)
- Fail-safe: On error, proceeds with quit to prevent user being stuck
- IPC-based: Main process coordinates with renderer via `quit:requested`/`quit:confirmResponse` channels
- Closes #64

**Files Created**: `src/shared/ipc/quit-schema.ts`, `src/renderer/src/utils/quitHelpers.ts`, `src/renderer/src/hooks/useQuitHandler.ts`, `src/main/ipc/quit-handlers.ts`

**Files Modified**: `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/main/index.ts`

**Testing**: 54 new tests added

### Watcher Auto-Restart with Exponential Backoff (Dec 21, 2025)
Added automatic recovery for file watchers on transient errors:
- Auto-restart with exponential backoff (800ms, 1600ms, 3200ms)
- Classifies errors as transient (ENOENT, EMFILE, EACCES, ESTALE) vs permanent
- Max 3 restart attempts before notifying user
- Restart statistics tracked in WatcherMetrics
- Closes #25

**Files**: `DirectoryWatcherService.ts`, `WatcherMetrics.ts`

### Preserve Line Breaks Option (Dec 21, 2025)
Added global setting to preserve single line breaks in markdown preview:
- New `editor.preserveLineBreaks` setting (default: false, CommonMark compliant)
- When enabled, single newlines render as `<br>` tags (uses `remark-breaks` plugin)
- Toggle in Settings overlay under "Editor" section
- Setting changes apply immediately without reload
- Closes #69

**Files**: `global-settings-schema.ts`, `MarkdownPreview.tsx`, `SettingsOverlay.tsx`, `useGlobalSettingsStore.ts`

### PDF and DOCX Export (Dec 21, 2025)
Added document export capabilities:

**PDF Export**:
- Export markdown to print-optimized PDF
- Vector Mermaid diagrams (not rasterized)
- A4 page size with print-friendly styling
- Uses Electron's `webContents.printToPDF()`

**DOCX Export**:
- Export markdown to Word format
- Mermaid diagrams as high-resolution PNG
- Uses `docx` npm package with `HtmlToDocxConverter`

**Files**: `PdfService.ts`, `DocxService.ts`, `HtmlToDocxConverter.ts`, `svgToImage.ts`

### YAML Frontmatter Rendering (Dec 21, 2025)
Added styled frontmatter display in markdown preview:
- Renders YAML frontmatter as key-value table
- Security-hardened parsing with size limits
- `FrontmatterTable.tsx` component

### Git Operation Queue (Dec 21, 2025)
Prevents index.lock conflicts during concurrent git operations:
- Sequential queue in `GitStatusService`
- Fixes race conditions when multiple git commands run simultaneously

### 2025 Security Hardening (Dec 2, 2025)
Comprehensive security upgrade following 2025 Electron best practices:

**Electron Upgrade**: 33.2.1 → 39.2.4 (Chromium 142, Node.js 22.20.0, V8 14.2)

**Process Sandboxing Enabled**:
- Removed outdated `sandbox: false` configuration (3-year-old misconception from pre-Electron 20)
- Restored Electron default sandbox (enabled since Electron 20, 2022)
- Preload scripts work perfectly with sandbox enabled

**Electron Fuses Implemented** (3 of 6 critical fuses):
- Prevents Living Off The Land (LOTL) attacks (CVE-2024-46992)
- `RunAsNode`: false - Disables ELECTRON_RUN_AS_NODE (prevents arbitrary code execution)
- `EnableNodeOptionsEnvironmentVariable`: false - Disables NODE_OPTIONS (prevents command injection)
- `EnableNodeCliInspectArguments`: false - Disables --inspect (prevents remote debugging)
- `EnableCookieEncryption`: false - Disabled to avoid macOS keychain prompts (UX decision)
- `EnableEmbeddedAsarIntegrityValidation`: N/A - Requires ASAR enabled
- `OnlyLoadAppFromAsar`: N/A - Requires ASAR enabled

**ASAR Configuration**:
- ASAR disabled (`asar: false`) due to runtime dependency loading issues
- Root cause: Deep transitive dependencies in isomorphic-git couldn't load from ASAR
- Error in production: `Cannot find module 'call-bind-apply-helpers'`
- Trade-off: Lost 2 ASAR-dependent fuses, but 3 critical fuses remain active

**experimentalFeatures Removed**:
- Evaluated and removed unnecessary flag
- All functionality (terminal, Monaco, Mermaid) works without it

**Build Configuration**:
- electron-builder: 26.0.0 with automated workaround for npm flattening bug (Issue #8068)
- Workaround: `prebuild` npm script creates aproba stub automatically
- Changed from universal to separate x64/arm64 binaries (fuses cause signature incompatibility)
- Build command: `npm run build:mac` (all prerequisites automated)
- Artifacts: erfana-{version}-{x64,arm64}.dmg + ZIP files

**Documentation**:
- Complete rewrite: `docs/security.md` with 2025 best practices
- Comprehensive fuses documentation with LOTL attack explanation
- Build configuration split into `docs/build/` folder
- Documented ASAR disabled trade-offs and rationale
- Documented electron-builder 26 workaround

**Testing**: All tests passing, dev + production builds verified

**References**:
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [LOTL Attack (Druva, Jan 2025)](https://www.druva.com/blog/living-off-the-land-lotl-attack-due-to-electron-fuses-misconfiguration)
- [CVE-2024-46992](https://nvd.nist.gov/vuln/detail/CVE-2024-46992)

**Files Modified**:
- `src/main/index.ts` - Removed outdated sandbox: false, removed experimentalFeatures
- `scripts/fuses.js` (NEW) - Electron fuses configuration (afterPack hook)
- `electron-builder.yml` - ASAR disabled, devDependency exclusions, per-architecture builds
- `electron.vite.config.ts` - Preload bundling for sandbox compatibility (removed externalizeDepsPlugin)
- `package.json` - Electron 39.2.4, electron-builder 26.0.0, prebuild script
- `docs/security.md` (NEW) - Comprehensive security documentation
- `docs/build/` (NEW) - Split build configuration documentation (8 files)
- `CLAUDE.md` - Condensed changelog, v0.4.x-v0.5.x moved to docs/CHANGELOG.md

### Settings Overlay (Dec 21, 2025)
Added full-screen settings overlay with keyboard navigation and focus management:

**Features**:
- Accessed via gear icon at bottom of left activity bar
- Full-screen overlay with header, close button, and placeholder content
- Escape key and close button dismiss overlay
- Focus trapping (prevents focus escaping overlay) with restoration on close
- Zustand store (`useSettingsStore`) for state management

**Implementation**:
- Created `SettingsOverlay` component with focus trap and keyboard handling
- Added `useSettingsStore` with `isOpen`, `openSettings()`, `closeSettings()`
- Integrated overlay into `App.tsx` root component
- Added gear icon to `ActivityBar` bottom section

**Testing**: 26 new tests added

**Files Modified**:
- `src/renderer/src/components/Settings/SettingsOverlay.tsx` (NEW) - Settings overlay component
- `src/renderer/src/components/Settings/SettingsOverlay.css` (NEW) - Overlay styling
- `src/renderer/src/stores/useSettingsStore.ts` (NEW) - Settings state management
- `src/renderer/src/App.tsx` - Integrated overlay
- `src/renderer/src/components/ActivityBar/ActivityBar.tsx` - Added gear icon
- Closes #48

### Visualize Prompt (Dec 21, 2025)
Added "Visualize" prompt to Preview context menu for AI-powered Mermaid diagram generation:

**Features**:
- Dialog with dropdown for 22 Mermaid diagram types (flowchart, sequence, class, state, ER, etc.)
- Optional textarea for additional instructions
- Generates Mermaid diagrams from selected text
- Extended PromptDialog component to support dropdown configuration

**Implementation**:
- Extended `PromptDialog` to accept dropdown configuration
- Added dropdown schema validation in `prompts/schema.ts`
- Created `visualize.md` template with diagram type variable
- Updated `PreviewContextMenu` to handle dropdown values
- Added `diagramType` to `PromptVariables` interface

**Testing**: 4 new tests added

**Files Modified**:
- `src/renderer/src/components/Dialog/PromptDialog.tsx` - Added dropdown support
- `src/renderer/src/prompts/schema.ts` - Added dropdown schema validation
- `src/renderer/src/prompts/visualize.md` (NEW) - Visualize prompt template
- `src/renderer/src/components/ContextMenu/PreviewContextMenu.tsx` - Added Visualize action
- Closes #57

### Logging Layer (Dec 21, 2025)
Implemented comprehensive logging system with file-based persistence and configurable log levels:

**Features**:
- Unified logging facades: `MainLogger` (main process) and `RendererLogger` (renderer process)
- File-based logging to `~/.erfana/logs/` directory
- Auto-rolling log files: 10MB size limit with 100-file rotation and 7-day retention
- 6 log levels: trace, debug, info, warn, error, fatal
- IPC integration: renderer logs sent to main process for centralized file storage
- Global settings integration: dynamic log level control via `logging.level` setting
- Console fallback: safe console wrapper for error scenarios

**Implementation**:
- Zod schema for log level validation in shared layer
- `LoggingService` singleton with electron-log file transport
- IPC handler for renderer-to-main log forwarding
- TypeScript facades (`MainLogger`, `RendererLogger`) with method-level typing
- Safe console wrapper (`safeConsole`) for critical error scenarios

**Testing**: 182 new tests added

**Files Modified**:
- `src/shared/ipc/logging-schema.ts` (NEW) - Zod schema for log levels and IPC payloads
- `src/main/services/LoggingService.ts` (NEW) - electron-log based logging service singleton
- `src/main/ipc/logging-handlers.ts` (NEW) - IPC handler for renderer logs
- `src/renderer/src/utils/logger.ts` (NEW) - RendererLogger facade with IPC integration
- `src/main/utils/safeConsole.ts` (NEW) - Safe console wrapper for error scenarios
- `src/main/index.ts` - Initialize LoggingService on app ready
- `src/preload/index.ts` - Expose logging IPC to renderer
- Closes #49

### Global Settings Service (Dec 21, 2025)
Implemented application-wide settings service for global configuration management:

**Features**:
- `GlobalSettingsService` in main process with Zod schema validation
- Settings persisted to `~/.erfana/settings.json`
- Corruption handling: backup to `.bak`, reset to defaults, warning logged
- Reactive updates via IPC broadcast to renderer
- `useGlobalSettingsStore` Zustand store with optimistic updates
- First setting: `logging.level` (ready for #49 integration)

**Implementation**:
- Created Zod schema with default values in shared layer
- Singleton service pattern with atomic read/write operations
- IPC handlers for get/update/reset operations
- Renderer store with automatic sync on project changes
- Initialization hook (`useGlobalSettingsInit`) for app-level setup

**Testing**: 71 new tests added

**Files Modified**:
- `src/shared/ipc/global-settings-schema.ts` (NEW) - Zod schema with defaults
- `src/main/services/GlobalSettingsService.ts` (NEW) - Main service singleton
- `src/main/ipc/global-settings-handlers.ts` (NEW) - IPC handlers
- `src/renderer/src/stores/useGlobalSettingsStore.ts` (NEW) - Zustand store
- `src/renderer/src/hooks/useGlobalSettingsInit.ts` (NEW) - Initialization hook
- Closes #50

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
- **Current**: 5049 tests passing (162 test files)

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

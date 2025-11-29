# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Version**: 0.5.2
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
│   ├── services/   # FileService, TerminalService, SettingsService, import/
│   └── ipc/        # IPC handlers
├── preload/        # Context bridge API
├── shared/         # Shared code (errors.ts, constants.ts)
└── renderer/       # React UI
    ├── components/ # UI components (Tabs/, Dialog/, ContextMenu/, etc.)
    ├── context/    # React contexts (ProjectManagementContext)
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams
2. **Project Tree** - File explorer with drag-drop reorganization, markdown filtering, context menu
3. **Terminal** - xterm.js with PTY backend
4. **Prompt Templates** - AI text operations via context menu

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, flickering prevention, scroll fixes
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage (2976 tests, 104 files)
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI for issues

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## Recent Changes (v0.5.3)
- **Fix: DiagramViewer Wrong Diagram on Expand** (Nov 29, 2025):
  - Fixed bug where expanding a Mermaid diagram in Preview sometimes opened a different diagram (issue #39)
  - Root cause: Position-based matching (20-line tolerance) caused false positives when diagrams <20 lines apart
  - Solution: Content-first identity with position tie-breaking:
    1. **Primary identity**: Content hash (`hashDiagramContent`) - survives line drift and external file reloads
    2. **Secondary identity**: Position proximity (10-line tolerance) - for edited content or identical diagrams
  - Content hash computed once at `openViewer()`, NEVER updated (stable identity)
  - Handles all scenarios: internal edits, external file changes, multiple identical diagrams
  - Store changes: Added `contentHash` and `originalEndLine` fields
  - 30 new regression tests for multi-diagram scenarios
  - **Total: 3003 tests passing (105 test files)**
  - Closes #39
- **Consolidate DiagramViewer Controls into Chat Panel** (Nov 29, 2025):
  - Moved toolbar controls into ChatBubble panel header (issue #37)
  - Removed 48px top toolbar, replaced with floating close button (28×28px, top-right)
  - Chat panel header now contains 3 control groups:
    1. Zoom controls: zoom in/out, zoom indicator, fit-to-view, reset
    2. Direction buttons: TB, LR, BT, RL (centered, for supported diagram types)
    3. Terminal controls: scroll-to-bottom, restart
  - FAB button icon changed from MessageCircle to Pencil (Edit diagram)
  - Removed close button from panel header (Escape or click outside to collapse)
  - Extended TerminalPortalContext with terminal control registration pattern
  - All keyboard shortcuts preserved (+, -, 0, F for zoom/fit)
  - Closes #37
- **Fix: DiagramViewer Refresh on Code Edit** (Nov 29, 2025):
  - Fixed bug where DiagramViewer would stop refreshing when diagram definition was modified (issue #38)
  - Root cause: Line number drift broke ID matching when user added/removed lines above diagram
  - Solution: Two-part matching strategy with `originalStartLine`:
    1. Store captures `originalStartLine` when viewer opens (NEVER updated)
    2. `updateDiagram` matches by `filePath` only (allows line drift)
    3. `MermaidDiagram` checks `startLine` within 20-line tolerance of `originalStartLine`
  - Now syncs `startLine`, `endLine`, and `diagramId` during updates
  - Works for edits within diagram block and when line numbers shift
  - Correctly handles multiple diagrams in same file (>20 lines apart)
  - Zoom/pan state still preserved during updates
  - Store changes: Added `originalStartLine` field
  - **Total: 2941 tests passing (104 test files)**
  - Closes #38
- **AI Chat Bubble in DiagramViewer** (Nov 28, 2025):
  - Floating chat bubble for contextual AI-assisted diagram modifications (issue #34)
  - FAB button in bottom-right corner of DiagramViewer, expands to slide-up panel
  - Auto-includes diagram context: Mermaid code, file path, line range
  - Cmd/Ctrl+Enter to send (matches PromptDialog pattern), Enter for newlines
  - Character limit: warning at 1000, max at 2000 characters
  - Click outside or Escape to collapse (preserves draft)
  - Input clears after send but panel stays expanded for follow-up messages
  - Zoom/pan state now persists across file changes (hasInitialized flag)
  - Pure logic extraction: `chatBubble.logic.ts` for testability
  - New files:
    - `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.tsx`: Chat component
    - `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.css`: Styles
    - `src/renderer/src/components/Editor/DiagramViewer/chatBubble.logic.ts`: Validation
    - `src/renderer/src/prompts/templates/mermaid-chat.md`: Prompt template
  - 66 new tests (38 logic + 28 component)
  - **Total: 2684 tests passing (94 test files)**
  - Closes #34

## Changes in v0.5.2
- **Mermaid Diagram Layout Direction Buttons** (Nov 28, 2025):
  - Add layout direction controls to Mermaid diagram hover toolbar (issue #32)
  - Unified toolbar: direction buttons + expand button appear on diagram hover
  - Comprehensive chart support: 7 Mermaid diagram types with direction capability:
    - flowchart/graph: TB, TD, BT, LR, RL (inline syntax)
    - stateDiagram, classDiagram, erDiagram, requirementDiagram: TB, BT, LR, RL (direction statement)
    - gitGraph: LR, TB, BT (colon syntax, LR default)
  - Current direction: disabled + highlighted (blue accent)
  - Clicking direction button executes prompt template with diagram context
  - Prompt includes file reference, line range, code, and target direction
  - Pure logic extraction: `mermaidDirections.ts` for testability
  - Helper functions: `usesDirectionStatement()`, `usesColonSyntax()` for syntax-aware prompts
  - New files:
    - `src/renderer/src/utils/mermaidDirections.ts`: Chart type detection, direction parsing
    - `src/renderer/src/components/Editor/MermaidToolbar/`: Unified toolbar component
    - `src/renderer/src/prompts/templates/mermaid-change-direction.md`: Prompt template
  - 151 new tests (125 logic + 26 component)
  - Closes #32

## Changes in v0.5.1
- **Mermaid Diagram Theming with Dark/Light Mode** (Nov 28, 2025):
  - Unified theming system for Mermaid diagrams with system preference detection
  - Consistent background colors between Preview and DiagramViewer components
  - Neutral/professional color palette optimized for readability in both modes
  - Auto-switching: Uses `prefers-color-scheme` media query with live updates
  - Architecture: Theme registry pattern for future theme expansion
  - New files:
    - `src/renderer/src/utils/mermaidThemes.ts`: Light/dark theme configurations
    - `src/renderer/src/stores/useThemeStore.ts`: System theme detection store
  - CSS updates: `@media (prefers-color-scheme: light)` blocks in MarkdownPreview.css and DiagramViewer.css
  - Fixed: DiagramViewer SVG had hardcoded white background (#ffffff) - now theme-aware
  - 43 new tests (22 for mermaidThemes, 21 for useThemeStore)
  - Closes #33
- **Fix: DiagramViewer Zoom Pixelation** (Nov 28, 2025):
  - Fixed Mermaid diagrams becoming pixelated when zooming (issue #31)
  - Root cause: CSS `transform: scale()` rasterizes SVG before scaling → pixelation
  - Solution: Scale SVG's width/height attributes directly (browser renders at target size natively)
  - Approach: Capture original dimensions → scale by zoom factor → CSS translate for panning
  - New pure functions for viewBox parsing (kept for potential future use)
  - Removed `will-change: transform` from CSS (no longer needed)
  - 51 new tests for viewBox functions
  - Closes #31
- **Full-Screen Mermaid Diagram Viewer** (Nov 27, 2025):
  - Expand Mermaid diagrams to full-screen overlay for detailed examination
  - Expand button appears on hover over diagrams (always visible on touch devices)
  - Zoom controls: mouse wheel zoom, +/- toolbar buttons
  - Pan support: click-drag to move diagram around viewport
  - Zoom indicator displays current zoom level percentage (e.g., "125%")
  - Fit-to-screen and reset buttons for quick navigation
  - Keyboard shortcuts: +/= (zoom in), - (zoom out), 0 (reset), F (fit), Escape (close)
  - Close via X button, Escape key, or backdrop click
  - Accessibility: ARIA labels, role="dialog", aria-modal, focus management, aria-live zoom indicator
  - Architecture: Pure logic extraction (`diagramViewer.logic.ts`) for testability
  - ViewBox-based zoom for crisp SVG scaling at any magnification level
  - SVG rendering uses same innerHTML injection as preview mode (Mermaid strict security)
  - Files: `src/renderer/src/components/Editor/DiagramViewer/`
  - 168 tests (128 logic + 40 component)
  - Closes #30

## Changes in v0.5.0 (was v0.4.8)
- **Smart Terminal File Links** (Nov 27, 2025):
  - Clickable file path links in terminal output with line:column support
  - Base feature: Detects absolute, relative, project-relative paths
  - Supports line:column notation (:42:10, (15,3))
  - Path validation with LRU cache (100 entries, 30s TTL)
  - Smart resolution: Falls back to filename search when exact path not found
  - FilePickerDialog: VS Code-style disambiguation when multiple files match
  - Keyboard navigation (Arrow Up/Down, Enter to select, Escape to cancel)
  - **Paths with spaces support** (VS Code-style fallback matchers):
    - Detects paths with spaces on their own line (e.g., `/Users/john/My Documents/report.pdf`)
    - Python error format: `File "/path/with spaces/file.py", line 42`
    - Windows paths: `C:\Program Files\My App\app.exe`
    - Bullet point lists: `- /path/to my/project/file.ts`
    - Based on VS Code Issue #97941 and PR #43733
  - Architecture: Pure logic extraction pattern for testability
    - `filenameIndex.ts`: Map-based O(1) filename lookup
    - `pathScoring.ts`: Candidate ranking algorithm
    - `smartPathResolver.logic.ts`: Resolution orchestration
    - `useFilenameIndex.ts`: Lazy index management hook
    - `FilePickerDialog.tsx`: Disambiguation UI component
    - `filePathLinks.logic.ts`: Fallback matchers for paths with spaces
  - 157 new tests for smart resolution and paths with spaces
  - Closes #26

## Changes in v0.4.7
- **Terminal Clipboard Support** (Nov 27, 2025):
  - Copy/paste operations in terminal panel via keyboard shortcuts and context menu
  - Smart Ctrl/Cmd+C: copies text when selected, sends SIGINT when no selection
  - Keyboard shortcuts: Ctrl+C/V (Windows/Linux), Cmd+C/V (macOS), Ctrl+Shift+C/V (explicit)
  - Right-click context menu with Copy (disabled when no selection) and Paste
  - Platform-specific shortcut display (⌘C/⌘V on macOS, Ctrl+C/Ctrl+V on Windows)
  - Selection preserved after copy (VS Code behavior), toast notification on success
  - Pure logic extraction pattern: `terminalClipboard.logic.ts` for testability
  - 103 new tests for clipboard functionality
  - Closes #28

## Changes in v0.4.6
- **VS Code-Inspired Watcher Performance** (Nov 25, 2025):
  - EventCoalescer, ThrottledWorker, AtomicSaveDetector, WatcherMetrics
  - 57 new tests for watcher components

## Changes in v0.4.5
- **File Watcher Selective Blacklist** (Nov 23, 2025):
  - Fixed issue #21: dotfolders like `.claude`, `.github` now properly watched
  - VS Code-style function-based ignore (more reliable than regex patterns)
  - Watches: `.claude/`, `.github/`, `.vscode/`, `.env`, dotfiles
  - Ignores (performance): `node_modules/`, `.venv/`, `.git/objects/`, build outputs
  - Closes #21
- **Unified Import System with Strategy Pattern** (Nov 23, 2025):
  - Refactored PDF import into extensible multi-file-type import architecture
  - Strategy Pattern: IConverter interface with PdfConverter, TextConverter implementations
  - Registry Pattern: ConverterRegistry maps extensions to converters
  - Factory Pattern: createConverterRegistry(), createImportService() for DI
  - Text file support: All UTF-8 files (txt, md, json, csv, xml, yaml, code files)
  - Text files keep original extension, PDFs convert to .md
  - Entry points: WelcomePanel "Import..." button, ProjectTree context menu
  - Architecture ready for future audio/video converters
  - Files: `src/main/services/import/` (types, converters/, ConverterRegistry, ImportService)
  - 296 new tests for import system (100% coverage)
- **Test Coverage**: **1923 tests passing (80 test files)**

## Changes in v0.4.4
- **PDF Import with AI-Assisted Organization** (Nov 22, 2025):
  - Import PDF files and convert to Markdown using @opendocsg/pdf2md
  - Output saved to `{project}/import/` directory (auto-created)
  - AI prompt auto-executes to help organize imported files
  - Error handling: Encrypted PDFs, empty PDFs, corrupted files, large files (>50MB warning)
  - Filename conflict resolution with auto-increment (file.md, file (1).md, etc.)
  - Closes #19
- **Organize-Import Prompt Enhancements** (Nov 22, 2025):
  - 7-step workflow: analyze document, analyze project conventions, suggest names/locations
  - 3-5 file name suggestions based on content and project conventions
  - 2-3 location suggestions with explanations
  - Cleanup option to delete original from import folder
  - Changed "Import PDF..." to "Import PDF" in menu
  - Closes #20

## Changes in v0.4.3
- **Terminal Scroll Auto-Recovery** (Nov 22, 2025):
  - Automatic detection and recovery from Claude Code Ink library scroll anomalies
  - Three-signal correlation: user scroll (300ms), data streaming (500ms), jump magnitude (≥10 lines)
  - `scrollAnomalyDetector.ts`: Pure detection logic (testable, no React)
  - `useScrollAnomalyRecovery.ts`: React hook integration with debounce
  - Complements existing "Scroll to Bottom" button with intelligent auto-recovery
  - 44 new tests (34 pure logic + 10 hook tests)
  - Closes #12
  - Files: `src/renderer/src/utils/scrollAnomalyDetector.ts`, `src/renderer/src/hooks/useScrollAnomalyRecovery.ts`

## Changes in v0.4.2
- **Chrome-style Dynamic Tabs** (Nov 22, 2025):
  - EditorTab component with dynamic sizing (min 80px, max 300px, flex 1 1 0)
  - Dirty indicator (filled circle) for unsaved changes
  - Close button with confirmation dialog for dirty files
  - Middle-click to close support
  - Context menu: Close, Close Others (with disabled state), Close All
  - Relative path tooltips from project root
  - Home/Welcome tab fixed at 41px (no scaling)
  - Hover indication on tabs
  - 62 new tests for tab functionality
  - Files: `src/renderer/src/components/Tabs/`
- **ContextMenu Disabled State** (Nov 22, 2025):
  - Added `disabled` property to ContextMenuItem interface
  - Disabled items are grayed out and non-clickable
- **implementing-issues skill** (Nov 22, 2025):
  - 11-phase workflow (Pre-flight → Release)
  - 3 complexity tiers with appropriate checkpoints
  - Agent orchestration with explicit Task tool examples
  - Templates for implementation plans and PR descriptions
  - Located in `.claude/skills/implementing-issues/`

## Changes in v0.4.0-0.4.1
- **ProjectManagementContext Singleton** (Nov 22, 2025):
  - Fixed duplicate toast issue when opening projects from Recent Projects
  - Both ProjectTree and WelcomePanel were creating separate useProjectManagement instances
  - Each registered their own IPC listeners causing duplicate "Project Opened" toasts
  - Solution: Context ensures only ONE instance, meaning ONE IPC listener and ONE toast per event
  - ISP-compliant hooks: `useProjectManagementContext()`, `useOpenProjectByPath()`, `useProjectChangedEffect()`
  - See `src/renderer/src/context/ProjectManagementContext.tsx`
- **Claude Code Skills** (Nov 22, 2025):
  - Added `managing-skills`: Guides through skill creation following best practices
  - Added `creating-issues`: Creates structured GitHub issues from user descriptions
  - Skills located in `.claude/skills/`

## Changes in v0.3.9
- **Auto-refresh Recent Projects** (Nov 21, 2025):
  - WelcomePanel subscribes to `project:changed` IPC event
  - Recent projects list updates automatically when opening/closing projects
  - No manual refresh needed
- **React 18 StrictMode Bug Fix** (Nov 21, 2025):
  - Fixed `isMounted` ref not resetting after StrictMode double-mount
  - Root cause: useRef values persist across unmount/remount
  - Fix: Reset `isMounted.current = true` in mount effect
- **Error Handling System** (Nov 21, 2025):
  - Created `src/shared/errors.ts` with `ErrorCode` enum (12 codes), `AppError` class
  - Utilities: `isProjectNotFoundError()`, `getUserFriendlyMessage()`, `ERROR_MESSAGES` map
  - Updated pathSecurity.ts and ProjectService.ts to use AppError
- **Shared Utilities** (Nov 21, 2025):
  - `src/shared/constants.ts`: MAX_RECENT_PROJECTS, TIME constants, TOAST_DURATION
  - `src/renderer/src/utils/toastHelpers.ts`: showErrorToast, showSuccessToast, showWarningToast
  - `src/renderer/src/utils/timeFormatting.ts`: formatRelativeTime utility
- **UIBlocker Refactoring** (Nov 21, 2025):
  - Split into UIBlockerBase (props-based) + UIBlocker (store-based)
  - Added fade-in animation (0.15s ease-out)
- **Test Coverage Improvements** (Nov 21, 2025):
  - pathSecurity.test.ts: 79 tests for security validation
  - SettingsService.recentProjects.test.ts: 39 tests
  - WelcomePanel.test.tsx: 34 tests + 11 integration tests
  - UIBlocker.test.tsx: 25 tests
  - file-handlers.openProjectByPath.test.ts: 34 tests
  - **Total: 1330 tests passing (62 test files)**

## Changes in v0.3.8
- **Markdown Link Security & Features** (Nov 2, 2025):
  - Fixed email links treated as internal links, changed color from teal to blue
  - Added dangerous protocol blocking (javascript:, data:, vbscript:, file://)
  - Fixed anchor-only links (#section) with smooth scrolling
  - Fixed heading slug generation (GitHub-compatible with unicode support)
  - Fixed email/tel tooltip cleanup (removes query parameters)
  - Created linkProtocols.ts utility for protocol validation
  - Added 55 new tests (96.7% coverage for link features)
- **Version Display in Title Bar** (Nov 2, 2025):
  - Production builds show "ERFANA v{version}" in system title bar
  - Development builds show "ERFANA" (no version)
  - Uses Electron's app.getVersion() API
  - See [src/main/index.ts](src/main/index.ts:28) and [src/main/index.test.ts](src/main/index.test.ts)

## Changes in v0.3.7
- **Electron Builder Optimization** (Nov 2, 2025):
  - Fixed critical recursive packaging bug (3.6GB → 231MB DMG)
  - Added exclusions: !release/**, !coverage/**, !tests/**, !vitest.*.ts, !*.md
  - Normal size for universal Electron app with Monaco + Mermaid
  - See [docs/build/build-optimization.md](docs/build/build-optimization.md)
- **ProjectTree.tsx Modularization** (Nov 1, 2025):
  - Reduced complexity by 38.4% (1,338 → 824 lines)
  - Applied SOLID principles + design patterns (Strategy, Command, Factory)
  - Created custom hooks: useProjectManagement, useFileOperations, useDirectoryWatcher
  - Context menu redesign: 11 command classes, node-type strategies, factory selection
  - New modules: switchHelpers, withWatcherPause, constants
  - See [docs/architecture.md](docs/architecture.md#projecttree-modularization)
- **Comprehensive Test Coverage** (Nov 1, 2025):
  - Added 320 new tests using "Extract Pure Logic" pattern
  - Phase 1-2: 147 P0 tests (context menu, switchHelpers, withWatcherPause)
  - Phase 3: 173 P1 tests (57 pure functions extracted from 3 hooks)
  - **Total: 964 tests passing (50 test files)**
  - Pattern: Extract pure logic → test independently → refactor hooks
  - Benefits: Fast (173 tests in ~24ms), deterministic, portable, maintainable
  - See [docs/testing/README.md](docs/testing/README.md#projecttree-refactoring)
- **Replace Confirmation Dialog** (Nov 1, 2025):
  - Added confirmation when cut+paste would overwrite existing files
  - New checkConflict detection before paste operations
  - replaceExisting parameter for moveItem operations

## Changes in v0.3.6
- **Drag-Drop CSS Layout Fix** (Nov 1, 2025):
  - Fixed layout shift issue (18px) when dragging items over folders
  - Replaced layout-affecting CSS with pseudo-element approach
  - Visual feedback preserved, zero layout shifts
  - See [docs/drag-drop/visual-feedback.md](docs/drag-drop/visual-feedback.md#css-layout-shift-fix)
- **Comprehensive Drag-Drop UX Improvements** (Nov 1, 2025):
  - Complete rewrite with VS Code-style behavior
  - Root folder node (project root as first tree item)
  - Auto-scroll (50px threshold, 60fps), Auto-expand (1s delay)
  - Smooth dragging (no jumping/shifting), custom collision detection
  - Keyboard shortcuts (Ctrl+X/C/V), context menu integration
  - SOLID refactoring: IFileService, PauseController, SymlinkDetector, RollbackHandler
  - 896 lines of new tests, architecture score 60→100
  - See [docs/drag-drop/README.md](docs/drag-drop/README.md)
- **Unified Dialog System**: Complete rewrite of dialog framework
  - Replaced old ConfirmDialog and UserInputDialog with new unified system
  - Created Dialog/ folder with BaseDialog, DialogContext, DialogManager, dialogService
  - Promise-based API via useDialog() hook (85% code reduction per usage)
  - Added AlertDialog (simple notifications), ConfirmDialog (yes/no with danger mode), PromptDialog (text input)
  - Z-index stacking for multiple dialogs, portal rendering (#portal-root)
  - Accessibility: ARIA labels, keyboard shortcuts (Enter/Esc), focus management
  - See [docs/architecture.md](docs/architecture.md#dialog-system)
- **SOLID Refactoring of File System Dialogs**: Applied SOLID principles to file/folder operations
  - Created fileValidation.ts with shared validation utilities (6 error codes)
  - Created FileSystemDialog.tsx as base component (consolidates common logic)
  - Created thin wrappers: NewFileDialog, NewFolderDialog, RenameDialog (~50 lines each)
  - Single Responsibility: Separated validation, base component, wrappers
  - Open/Closed: Base component configurable via props, closed for modification
  - Dependency Inversion: Validation abstracted from UI
  - Cross-platform validation: case-insensitive duplicates, Windows reserved names (CON, PRN, etc.)
  - Dotfile edge cases: `.CON` is valid, `CON` without dot is reserved
  - Features: Character counter (255 limit), inline validation, auto-focus, keyboard shortcuts
- **Comprehensive Test Coverage**: Added 129 new tests
  - fileValidation.test.ts: 80 tests covering all validation scenarios
  - FileSystemDialog.test.tsx: 49 tests covering component behavior (focus, input, validation, keyboard, ARIA)
  - WrapperDialogs.test.tsx: Integration tests for wrapper components
  - **Total: 549 tests passing (35 test files)**
  - All typecheck, lint, and tests passing
  - See [docs/testing/README.md](docs/testing/README.md#dialog-system)

## Changes in v0.3.5
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

# Erfana Changelog

Historical changelog entries. For recent changes (v0.4.0+), see [CLAUDE.md](../CLAUDE.md).

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
  - See [src/main/index.ts](../src/main/index.ts:28) and [src/main/index.test.ts](../src/main/index.test.ts)

## Changes in v0.3.7
- **Electron Builder Optimization** (Nov 2, 2025):
  - Fixed critical recursive packaging bug (3.6GB → 231MB DMG)
  - Added exclusions: !release/**, !coverage/**, !tests/**, !vitest.*.ts, !*.md
  - Normal size for universal Electron app with Monaco + Mermaid
  - See [docs/build/build-optimization.md](build/build-optimization.md)
- **ProjectTree.tsx Modularization** (Nov 1, 2025):
  - Reduced complexity by 38.4% (1,338 → 824 lines)
  - Applied SOLID principles + design patterns (Strategy, Command, Factory)
  - Created custom hooks: useProjectManagement, useFileOperations, useDirectoryWatcher
  - Context menu redesign: 11 command classes, node-type strategies, factory selection
  - New modules: switchHelpers, withWatcherPause, constants
  - See [docs/architecture.md](architecture.md#projecttree-modularization)
- **Comprehensive Test Coverage** (Nov 1, 2025):
  - Added 320 new tests using "Extract Pure Logic" pattern
  - Phase 1-2: 147 P0 tests (context menu, switchHelpers, withWatcherPause)
  - Phase 3: 173 P1 tests (57 pure functions extracted from 3 hooks)
  - **Total: 964 tests passing (50 test files)**
  - Pattern: Extract pure logic → test independently → refactor hooks
  - Benefits: Fast (173 tests in ~24ms), deterministic, portable, maintainable
  - See [docs/testing/README.md](testing/README.md#projecttree-refactoring)
- **Replace Confirmation Dialog** (Nov 1, 2025):
  - Added confirmation when cut+paste would overwrite existing files
  - New checkConflict detection before paste operations
  - replaceExisting parameter for moveItem operations

## Changes in v0.3.6
- **Drag-Drop CSS Layout Fix** (Nov 1, 2025):
  - Fixed layout shift issue (18px) when dragging items over folders
  - Replaced layout-affecting CSS with pseudo-element approach
  - Visual feedback preserved, zero layout shifts
  - See [docs/drag-drop/visual-feedback.md](drag-drop/visual-feedback.md#css-layout-shift-fix)
- **Comprehensive Drag-Drop UX Improvements** (Nov 1, 2025):
  - Complete rewrite with VS Code-style behavior
  - Root folder node (project root as first tree item)
  - Auto-scroll (50px threshold, 60fps), Auto-expand (1s delay)
  - Smooth dragging (no jumping/shifting), custom collision detection
  - Keyboard shortcuts (Ctrl+X/C/V), context menu integration
  - SOLID refactoring: IFileService, PauseController, SymlinkDetector, RollbackHandler
  - 896 lines of new tests, architecture score 60→100
  - See [docs/drag-drop/README.md](drag-drop/README.md)
- **Unified Dialog System**: Complete rewrite of dialog framework
  - Replaced old ConfirmDialog and UserInputDialog with new unified system
  - Created Dialog/ folder with BaseDialog, DialogContext, DialogManager, dialogService
  - Promise-based API via useDialog() hook (85% code reduction per usage)
  - Added AlertDialog (simple notifications), ConfirmDialog (yes/no with danger mode), PromptDialog (text input)
  - Z-index stacking for multiple dialogs, portal rendering (#portal-root)
  - Accessibility: ARIA labels, keyboard shortcuts (Enter/Esc), focus management
  - See [docs/architecture.md](architecture.md#dialog-system)
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
  - See [docs/testing/README.md](testing/README.md#dialog-system)

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
  - See [docs/prompts/](prompts/) for split documentation (autoexecute-overview, technical, testing, reference)
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
  - See [docs/prompts/implementation.md](prompts/implementation.md) for implementation details

## Changes in v0.3.2
- **Terminal Flickering Prevention**: Fixed terminal rendering flicker in production builds
  - Added Electron WebGL command line switches for Electron 33 compatibility
  - Enhanced WebGL context recovery with automatic retry after loss
  - Integer dimension enforcement (Math.floor) to prevent fractional oscillation
  - Dimension change threshold (≥2 cols OR ≥1 row) to filter devicePixelRatio noise
  - 6 comprehensive tests in TerminalPanel.flickering.test.tsx
  - Related: xterm.js #4922, Electron 33 WebGL context management
- **Scroll to Bottom Button**: Added manual workaround for Claude Code scroll jumping
  - New button (icon) in terminal header
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

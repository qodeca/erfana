# Erfana Changelog

Historical changelog entries for versions prior to current. For the latest changes, see [CLAUDE.md](../CLAUDE.md).

## [0.6.5-gamma] - 2026-01-18

### Added
- **External file drop to project tree** (BRS-012): Drag files from Finder or file managers into project tree (#87)
  - Drop mode dialog: Move, Copy, or Import options
  - Conflict resolution: Replace or Keep Both
  - Keyboard shortcut: Cmd/Ctrl+Shift+I to import via file picker
  - Security: Path traversal protection, symlink validation, project boundary enforcement
  - useExternalFileDrop hook, ExternalFileService backend
  - 899 new tests for external file drop
- **Terminal panel refactoring**: Extracted modular hooks and components
  - Hooks: useTerminalDragDrop, useScreenshotCapture, useTerminalResize, useTerminalPortal
  - Components: TerminalToolbar, TerminalStatusContent
  - Improved testability and maintainability
- **Import workflow improvements**: Unified processFiles method with batch size limits and better error handling

## [0.6.5] - 2026-01-16

### Added
- Terminal drag-drop: Insert quoted file paths by dropping files from project tree or Finder (#85)
- Screenshot capture buttons in terminal panel (macOS only): Capture screen, window, or area selection with file path pasted to terminal (#86)
  - Three toolbar buttons: Capture Screen, Capture Window (picker), Capture Area (crosshair)
  - Multi-monitor support: display selection dialog for Capture Screen
  - Screenshots saved to OS temp directory as PNG with timestamp
  - 30-second timeout for interactive selections
  - Unified shell-safe path quoting (single quotes) for screenshot and drag-drop
  - 51 new tests

## Changes in v0.6.4
- **E2E Testing Infrastructure** (Dec 27-28, 2025):
  - Split e2e-testing.md into focused modules (7 files)
  - Added 11 lessons learned in e2e-lessons-learned.md
  - Robust dialog handling and native dialog mocking
  - Terminal visibility fix: Playwright auto-retry instead of manual polling
  - Monaco keyboard input fix: Playwright auto-retry instead of fixed 500ms timeout
  - New helpers: `getTextArea()`, `waitForCursor()` for Monaco focus verification
  - 138 testids across all interactive components
  - Closes #79, #80, #81, #83
- **MarkdownEditorPanel Modular Refactoring** (Dec 27, 2025):
  - Extracted modular components from monolithic panel
  - New folder: `src/renderer/src/components/Editor/MarkdownEditorPanel/`
  - Components: MarkdownToolbar, EditorErrorBoundary
  - Hooks: useScrollSync, useExportHandlers, useDividerPosition, useEditorContextMenu, useKeyboardShortcuts
  - DocumentStatsBar, EditorContentLayout components
- **Logging Instance ID** (Dec 26, 2025):
  - Added instance ID to log entries for multi-instance isolation
  - Helps debug multi-window scenarios
- **BRS-011: Automated UI Testing Compatibility** (Dec 27, 2025):
  - New T3 BRS for Playwright/E2E testing infrastructure
  - 42 requirements (26 FR + 6 NFR + 10 AC)
  - TypeScript constants, portal-aware helpers
- **Total: 5612 tests passing** (180 test files)

## Changes in v0.6.4-gamma
- **Multi-Instance Support with Project Locking** (Dec 25, 2025):
  - Multiple independent Erfana instances can run simultaneously
  - File-based project locking prevents duplicate project opens
  - Duplicate project attempts focus existing window (VS Code behavior)
  - Stale lock detection: PID check + 60-min timeout
  - 500ms focus polling for cross-instance coordination
  - 206 new tests
  - Closes #27
- **Cross-Platform New Window Functionality** (Dec 26, 2025):
  - macOS: Dock right-click menu with "New Window" option
  - Windows: Taskbar jump list with "New Window" option
  - All platforms: File > New Window menu item (Cmd/Ctrl+Shift+N)
  - 51 new tests
  - Closes #77
- **Total: 5255 tests passing** (163 test files)

## Changes in v0.6.4-beta
- **Editor Context Menu with AI Prompts** (Dec 25, 2025):
  - Right-click with text selected shows context menu in Monaco editor
  - 5 new editor-specific prompts: Elaborate, Modify, Ask, Visualize, Prompt
  - Prompts filtered by `area: code-editor`, `subArea: context-menu`
  - Menu dismisses on Escape, click outside, or action execution
  - 8 new tests
  - Closes #73
- **Real-time Git Status Refresh** (Dec 25, 2025):
  - Multi-path git state watching (.git/index, HEAD, refs/heads, FETCH_HEAD, stash)
  - Hybrid polling fallback for network/cloud drives
  - Event coalescing (150ms window) to prevent refresh storms
  - Latency reduced from ~2s to ~750ms
  - Auto-recovery with exponential backoff
  - User-configurable polling in Settings overlay
  - 151 new tests
  - Closes #74
- **Unified In-File Search** (Dec 22, 2025):
  - Cmd/Ctrl+F search in editor and preview panes
  - Case sensitivity and whole word toggles
  - Match highlighting with CSS Highlight API
  - 163 new tests
  - Closes #71
- **Auto-Open Terminal** (Dec 22, 2025):
  - Terminal panel auto-opens when project loads
  - Remembers user close preference until next project
  - 41 new tests
  - Closes #55
- **Preserve Line Breaks Option** (Dec 21, 2025):
  - New setting to render single newlines as `<br>` tags
  - Closes #69
- **Quit Confirmation** (Dec 21, 2025):
  - Prompts before quitting with unsaved changes or active terminals
  - 54 new tests
  - Closes #64
- **Total: 5049 tests passing** (162 test files) at release

## Changes in v0.6.3
- **Logging Improvements** (Dec 21, 2025):
  - Separate log files: `main.log`, `renderer.log`, `combined.log`
  - 100-file rotation (increased from daily rotation)
  - Settings log level dropdown in Settings overlay
  - **Total: 4264 tests passing** (141 test files)
  - Closes #70

## Changes in v0.6.2
- **DOCX Export** (Dec 21, 2025):
  - Export markdown to Word format
  - Mermaid diagrams as high-resolution PNG images
  - HTML to DOCX conversion via `docx` library
  - 69 new tests
  - Closes #65
- **PDF Export** (Dec 21, 2025):
  - Export markdown to print-optimized PDF
  - Vector Mermaid diagrams (not rasterized)
  - A4 page size with print-friendly styling
  - 35 new tests
  - Closes #58
- **YAML Frontmatter Rendering** (Dec 21, 2025):
  - Styled key-value table in markdown preview
  - Security-hardened parsing with size limits
  - 18 new tests
- **Git Operation Queue** (Dec 21, 2025):
  - Prevents index.lock conflicts during concurrent git operations
  - Sequential queue in GitStatusService
  - Closes race conditions

## Changes in v0.6.0
- **Logging Layer** (Dec 21, 2025):
  - Unified logging facades: MainLogger (main process) and RendererLogger (renderer process)
  - File-based logging to `~/.erfana/logs/` directory
  - Auto-rolling log files: 10MB size limit + daily rotation with 7-day retention
  - 6 log levels: trace, debug, info, warn, error, fatal
  - IPC integration: renderer logs sent to main process for centralized file storage
  - Global settings integration: dynamic log level control via `logging.level` setting
  - 182 new tests
  - **Total: 4226 tests passing** (139 test files)
  - Closes #49
- **Global Settings Service** (Dec 21, 2025):
  - Application-wide settings service with Zod schema validation
  - Settings persisted to `~/.erfana/settings.json`
  - Corruption handling: backup to `.bak`, reset to defaults
  - 71 new tests
  - Closes #50
- **Visualize Prompt** (Dec 21, 2025):
  - Added "Visualize" prompt to Preview context menu for AI-powered Mermaid diagram generation
  - Dialog with dropdown for 22 Mermaid diagram types
  - 4 new tests
  - Closes #57
- **Settings Overlay** (Dec 21, 2025):
  - Full-screen settings overlay with keyboard navigation and focus management
  - 26 new tests
  - Closes #48
- **2025 Security Hardening** (Dec 2, 2025):
  - Electron 33.2.1 → 39.2.4 (Chromium 142, Node.js 22.20.0, V8 14.2)
  - Process sandboxing enabled, Electron fuses implemented (3 of 6)
  - electron-builder 26.0.0 with automated workarounds

## Changes in v0.5.4
- **Forced Scroll-to-Bottom After Prompt Execution** (Dec 1, 2025):
  - Automatically scrolls terminal to bottom 1 second after prompt template execution (issue #52)
  - **User Intent Respect**: Skips scroll if user manually scrolled during delay window
  - **Integration**: Works with all prompt templates
  - **Architecture**: Pure logic module (`promptScrollScheduler.logic.ts`)
  - New files: promptScrollScheduler.logic.ts + tests (66 tests)
  - **Total: 3469 tests passing** (119 test files)
  - Closes #52
- **Mermaid Toolbar Restructuring** (Dec 1, 2025):
  - Unified toolbar design with expand button integrated into direction container
  - **Sizing**: Expand button resized to 24px height (matches direction buttons)
  - **Hover**: Unified lime hover for all buttons
  - Closes #53
- **Flicker-Free Terminal Scroll Recovery** (Dec 1, 2025):
  - Eliminated visible flicker using xterm.js parser hooks for same-frame scroll restoration
  - Two-layer defense: parser hooks (primary) + multi-signal detection (fallback)
  - New files: useTerminalParserHooks.ts + tests (24 tests)
  - Addresses Claude Code issues #826, #10769
- **Git Status Light Colors** (Dec 1, 2025):
  - Added lighter color variants for git status indicators (40-50% lighter)
  - Context-specific: light for badges/text, vibrant for folder dots
  - WCAG AA compliance
- **Git Status Indicators in Project Tree** (Nov 30, 2025):
  - VS Code-style git status indicators (M/U/D/A/! badges)
  - Folder status propagation with colored dots
  - Git status bar: branch name + colored counts
  - Auto-refresh: 1s debounce, 2s cooldown
  - isomorphic-git library (no git CLI dependency)
  - **Total: 3352 tests passing** (117 test files)
  - Closes #29
- **Fix: Git Status Not Updating After File Operations** (Nov 30, 2025):
  - Fixed race conditions and cooldown logic
  - Known limitation: Global `.gitignore` not supported
- **Terminal Panel Requires Project** (Nov 30, 2025):
  - Terminal panel hidden when no project loaded
  - Dynamic panel add/remove from SplitviewReact
  - 46 new tests
  - Closes #46
- **Fix: Terminal AutoExecute Regression & Infinite Loop** (Nov 30, 2025):
  - 200ms delay pattern for PTY buffering
  - Ref-only approach to prevent re-render cycle
  - Closes #41
- **Complete Style Guide Compliance Audit** (Nov 30, 2025):
  - Migrated all 23 CSS files to design tokens (100% compliance)
- **Fix: DiagramViewer Wrong Diagram on Expand** (Nov 29, 2025):
  - Content-first identity with position tie-breaking
  - Content hash for stable identity
  - **Total: 3003 tests passing** (105 test files)
  - Closes #39
- **Consolidate DiagramViewer Controls into Chat Panel** (Nov 29, 2025):
  - Removed 48px toolbar, added floating close button
  - Chat panel header with 3 control groups
  - Closes #37
- **Fix: DiagramViewer Refresh on Code Edit** (Nov 29, 2025):
  - Fixed line number drift matching issue
  - Two-part matching strategy with originalStartLine
  - **Total: 2941 tests passing** (104 test files)
  - Closes #38
- **AI Chat Bubble in DiagramViewer** (Nov 28, 2025):
  - Floating chat bubble for AI-assisted diagram modifications
  - Auto-includes diagram context
  - Cmd/Ctrl+Enter to send
  - Character limit: 1000 warning, 2000 max
  - 66 new tests
  - **Total: 2684 tests passing** (94 test files)
  - Closes #34

## Changes in v0.5.2
- **Mermaid Diagram Layout Direction Buttons** (Nov 28, 2025):
  - Layout direction controls in diagram hover toolbar
  - 7 Mermaid diagram types supported
  - Prompt template with diagram context
  - 151 new tests
  - Closes #32

## Changes in v0.5.1
- **Mermaid Diagram Theming with Dark/Light Mode** (Nov 28, 2025):
  - System preference detection
  - Theme registry pattern
  - 43 new tests
  - Closes #33
- **Fix: DiagramViewer Zoom Pixelation** (Nov 28, 2025):
  - Scale SVG width/height directly (no CSS transform)
  - 51 new tests
  - Closes #31
- **Full-Screen Mermaid Diagram Viewer** (Nov 27, 2025):
  - Expand diagrams to full-screen overlay
  - Zoom, pan, fit-to-screen controls
  - Keyboard shortcuts: +, -, 0, F, Escape
  - Accessibility: ARIA labels, focus management
  - 168 tests
  - Closes #30

## Changes in v0.5.0 (was v0.4.8)
- **Smart Terminal File Links** (Nov 27, 2025):
  - Clickable file paths with line:column support
  - Smart resolution with filename fallback
  - FilePickerDialog for disambiguation
  - Paths with spaces support (VS Code-style)
  - 157 new tests
  - Closes #26

## Changes in v0.4.7
- **Terminal Clipboard Support** (Nov 27, 2025):
  - Copy/paste via keyboard shortcuts and context menu
  - Smart Ctrl/Cmd+C (copy when selected, SIGINT when not)
  - Platform-specific shortcuts
  - 103 new tests
  - Closes #28

## Changes in v0.4.6
- **VS Code-Inspired Watcher Performance** (Nov 25, 2025):
  - EventCoalescer, ThrottledWorker, AtomicSaveDetector, WatcherMetrics
  - 57 new tests

## Changes in v0.4.5
- **File Watcher Selective Blacklist** (Nov 23, 2025):
  - VS Code-style function-based ignore
  - Watches: `.claude/`, `.github/`, `.vscode/`
  - Ignores: `node_modules/`, `.venv/`, `.git/objects/`
  - Closes #21
- **Unified Import System with Strategy Pattern** (Nov 23, 2025):
  - Strategy, Registry, Factory patterns
  - PDF and text file support
  - 296 new tests
  - **Total: 1923 tests passing** (80 test files)

## Changes in v0.4.4
- **PDF Import with AI-Assisted Organization** (Nov 22, 2025):
  - PDF to Markdown conversion (@opendocsg/pdf2md)
  - Output to `{project}/import/` directory
  - AI prompt auto-executes
  - Error handling: encrypted, empty, corrupted, large files
  - Closes #19
- **Organize-Import Prompt Enhancements** (Nov 22, 2025):
  - 7-step workflow
  - 3-5 file name suggestions
  - 2-3 location suggestions
  - Cleanup option
  - Closes #20

## Changes in v0.4.3
- **Terminal Scroll Auto-Recovery** (Nov 22, 2025):
  - Automatic detection/recovery from Claude Code Ink scroll anomalies
  - Three-signal correlation
  - Pure logic extraction pattern
  - 44 new tests
  - Closes #12

## Changes in v0.4.2
- **Chrome-style Dynamic Tabs** (Nov 22, 2025):
  - Dynamic sizing (min 80px, max 300px)
  - Dirty indicator, close button, middle-click
  - Context menu: Close, Close Others, Close All
  - 62 new tests
- **ContextMenu Disabled State** (Nov 22, 2025):
  - Added `disabled` property to ContextMenuItem
- **implementing-issues skill** (Nov 22, 2025):
  - 11-phase workflow
  - 3 complexity tiers
  - Located in `.claude/skills/implementing-issues/`

## Changes in v0.4.0-0.4.1
- **ProjectManagementContext Singleton** (Nov 22, 2025):
  - Fixed duplicate toast issue
  - ISP-compliant hooks
- **Claude Code Skills** (Nov 22, 2025):
  - Added `managing-skills` and `creating-issues` skills
  - Located in `.claude/skills/`

## Changes in v0.3.9
- **Auto-refresh Recent Projects** (Nov 21, 2025):
  - WelcomePanel subscribes to `project:changed` IPC event
- **React 18 StrictMode Bug Fix** (Nov 21, 2025):
  - Fixed `isMounted` ref not resetting
- **Error Handling System** (Nov 21, 2025):
  - Created `src/shared/errors.ts`
  - `ErrorCode` enum, `AppError` class
- **Shared Utilities** (Nov 21, 2025):
  - `src/shared/constants.ts`
  - Toast helpers, time formatting
- **Test Coverage Improvements** (Nov 21, 2025):
  - **Total: 1330 tests passing** (62 test files)

## Changes in v0.3.8
- **Markdown Link Security & Features** (Nov 2, 2025):
  - Fixed email links, dangerous protocol blocking
  - Anchor-only links with smooth scrolling
  - 55 new tests
- **Version Display in Title Bar** (Nov 2, 2025):
  - Production builds show version in title bar

## Changes in v0.3.7
- **Electron Builder Optimization** (Nov 2, 2025):
  - Fixed recursive packaging bug (3.6GB → 231MB)
- **ProjectTree.tsx Modularization** (Nov 1, 2025):
  - Reduced complexity by 38.4%
  - SOLID principles + design patterns
- **Comprehensive Test Coverage** (Nov 1, 2025):
  - Added 320 new tests
  - **Total: 964 tests passing** (50 test files)
- **Replace Confirmation Dialog** (Nov 1, 2025):
  - Confirmation when cut+paste would overwrite

## Changes in v0.3.6
- **Drag-Drop CSS Layout Fix** (Nov 1, 2025):
  - Fixed 18px layout shift issue
- **Comprehensive Drag-Drop UX Improvements** (Nov 1, 2025):
  - VS Code-style behavior
  - Auto-scroll, auto-expand
  - 896 lines of new tests
- **Unified Dialog System**:
  - Promise-based API via useDialog() hook
  - BaseDialog, DialogContext, DialogManager
- **SOLID Refactoring of File System Dialogs**:
  - fileValidation.ts with shared utilities
  - FileSystemDialog.tsx as base component
- **Comprehensive Test Coverage**:
  - **Total: 549 tests passing** (35 test files)

## Changes in v0.3.5
- **Comprehensive Test Coverage for Prompt System**:
  - 319 new automated tests
  - **Total: 395 tests passing** (32 test files)
  - Coverage: 98.59% statements

## Changes in v0.3.4
- **AutoExecute Simplification**:
  - Reverted to fire-and-forget approach
  - Removed Promise-based writes
  - 200ms delay (industry standard)
  - 10 comprehensive tests
- **Documentation Token Efficiency Improvements**:
  - Moved graph-engine docs to docs/future/
  - Split docs/prompts/implementation.md

## Changes in v0.3.3
- **AutoExecute Race Condition Fix**:
  - Promise-based writes with completion callbacks
  - Terminal initialization polling
  - 13 comprehensive tests

## Changes in v0.3.2
- **Terminal Flickering Prevention**:
  - WebGL command line switches
  - 6 comprehensive tests
- **Scroll to Bottom Button**:
  - Manual workaround for scroll jumping
- **Documentation Restructuring**:
  - terminal.md split into subfolder

## Changes in v0.3.1
- **Terminal Scroll Fix**:
  - Scroll position tracking
  - 6 comprehensive tests

## Changes in v0.3.0
- **Terminal Bootstrap Pattern**:
  - Zero visible initialization commands
  - 18 comprehensive tests
- Symlink indicators in Project Tree
- Watcher depth setting
- Improved editor/preview scroll sync
- Fixed EPIPE errors

# Changelog – v0.3.0 through v0.5.4

Historical changelog entries for versions v0.3.0–v0.5.4. For current changes see [CHANGELOG.md](../CHANGELOG.md).

---

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

## v0.5.0–v0.5.2
- Mermaid diagram layout direction buttons, 7 diagram types (#32) (v0.5.2)
- Mermaid theming with dark/light mode (#33), zoom pixelation fix (#31), full-screen viewer (#30) (v0.5.1)
- Smart terminal file links with line:column support, FilePickerDialog (#26) (v0.5.0)

## v0.4.5–v0.4.7
- Terminal clipboard support: copy/paste, smart Ctrl/Cmd+C (#28) (v0.4.7)
- VS Code-inspired watcher performance: EventCoalescer, ThrottledWorker, AtomicSaveDetector (v0.4.6)
- File watcher selective blacklist, unified import system with strategy pattern (#21) (v0.4.5)

## v0.4.2–v0.4.4
- PDF import with AI-assisted organization (#19), organize-import prompt enhancements (#20) (v0.4.4)
- Terminal scroll auto-recovery with three-signal correlation (#12) (v0.4.3)
- Chrome-style dynamic tabs, ContextMenu disabled state, implementing-issues skill (v0.4.2)

## v0.4.0–v0.4.1
- ProjectManagementContext singleton, Claude Code skills (v0.4.0–v0.4.1)

## v0.3.0–v0.3.9
- Terminal bootstrap, scroll fix, WebGL flicker fix, AutoExecute race condition fix (v0.3.0–v0.3.3)
- Prompt system tests (319 tests, 98.59%), drag-drop UX, dialog system refactoring (v0.3.4–v0.3.6)
- Electron builder fix (3.6GB -> 231MB), ProjectTree modularization (v0.3.7)
- Markdown link security, auto-refresh recent projects, error handling system (v0.3.8–v0.3.9)

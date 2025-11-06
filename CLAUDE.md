<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Version**: 0.3.8
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
2. **Project Tree** - File explorer with drag-drop reorganization, markdown filtering, context menu
3. **Terminal** - xterm.js with PTY backend
4. **Prompt Templates** - AI text operations via context menu

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Architectural Review](docs/architectural-review/README.md) — Code quality assessment, security, testing gaps
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, flickering prevention, scroll fixes
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage
- [Known Issues](docs/known-issues.md) — Limitations and workarounds

## OpenSpec - Spec-Driven Development

### What is OpenSpec?
OpenSpec is a structured specification system for managing changes in this project. It uses a three-stage workflow to ensure changes are well-documented, validated, and traceable.

### When to Use OpenSpec
**CREATE A PROPOSAL** when you need to:
- Add new features or capabilities
- Make breaking changes (API, schema, architecture)
- Change architectural patterns or system design
- Optimize performance (changes behavior)
- Update security patterns

**SKIP PROPOSAL** for:
- Bug fixes (restoring intended behavior)
- Typos, formatting, comments
- Non-breaking dependency updates
- Configuration changes
- Tests for existing behavior

### Three-Stage Workflow

#### Stage 1: Creating Changes (Proposal)
Trigger: *"Help me create a change proposal"* or *"I want to create a spec"*

```bash
# 1. Review current state
openspec list              # Active changes
openspec list --specs      # Existing capabilities

# 2. Create proposal (use slash command)
/openspec:proposal

# 3. Validate before sharing
openspec validate [change-id] --strict
```

**Structure:**
```
openspec/changes/[change-id]/
├── proposal.md            # Why, what, impact
├── tasks.md              # Implementation checklist
├── design.md             # Technical decisions (optional)
└── specs/                # Delta changes
    └── [capability]/
        └── spec.md       # ADDED/MODIFIED/REMOVED requirements
```

#### Stage 2: Implementing Changes (Apply)
Trigger: *"Apply the [change-id] proposal"* or *"Implement [change-id]"*

```bash
# Use slash command to track implementation
/openspec:apply [change-id]
```

**Workflow:**
1. Read `proposal.md` - Understand what's being built
2. Read `design.md` (if exists) - Review technical decisions
3. Read `tasks.md` - Get implementation checklist
4. Implement tasks sequentially - Complete in order
5. Update checklist - Mark `- [x]` after completion
6. Test and validate - Ensure all tests pass

#### Stage 3: Archiving Changes (Archive)
After deployment and verification:

```bash
# Use slash command to archive
/openspec:archive [change-id]

# This will:
# - Move changes/[id]/ → changes/archive/YYYY-MM-DD-[id]/
# - Update specs/ with merged requirements
# - Run validation to confirm success
```

### Available Commands

```bash
# Essential commands
openspec list                      # List active changes
openspec list --specs              # List specifications
openspec show [item]               # Display change or spec
openspec validate [item] --strict  # Validate changes
openspec archive <change-id> --yes # Archive (non-interactive)

# Slash commands (AI-assisted)
/openspec:proposal                 # Create new proposal
/openspec:apply [change-id]        # Implement proposal
/openspec:archive [change-id]      # Archive completed change
```

### Directory Structure

```
openspec/
├── project.md              # Project conventions & context
├── AGENTS.md               # Detailed instructions for AI
├── specs/                  # Current truth - what IS built
│   └── [capability]/
│       ├── spec.md         # Requirements and scenarios
│       └── design.md       # Technical patterns (optional)
├── changes/                # Proposals - what SHOULD change
│   ├── [change-id]/        # Active proposals
│   │   ├── proposal.md
│   │   ├── tasks.md
│   │   ├── design.md       # Optional
│   │   └── specs/          # Delta changes per capability
│   └── archive/            # Completed changes
│       └── YYYY-MM-DD-[change-id]/
```

### Best Practices

**Change ID Naming:**
- Use kebab-case, short and descriptive
- Prefer verb-led prefixes: `add-`, `update-`, `remove-`, `refactor-`
- Examples: `add-two-factor-auth`, `refactor-terminal-service`, `update-dialog-system`

**Spec Delta Format:**
```markdown
## ADDED Requirements
### Requirement: New Feature
The system SHALL provide...

#### Scenario: Success case
- **WHEN** user performs action
- **THEN** expected result

## MODIFIED Requirements
### Requirement: Existing Feature
[Complete modified requirement with all scenarios]

## REMOVED Requirements
### Requirement: Old Feature
**Reason**: [Why removing]
**Migration**: [How to handle]
```

**Validation Rules:**
- Every requirement MUST have at least one scenario
- Use `#### Scenario:` format (4 hashtags, not bullets)
- Run `openspec validate --strict` before sharing proposals
- Always include at least one delta (ADDED/MODIFIED/REMOVED)

### Integration with Development Workflow

1. **Planning Phase**: Use OpenSpec for feature design and specification
2. **Implementation Phase**: Reference `tasks.md` for checklist, update as you go
3. **Testing Phase**: Validate against scenarios in `spec.md`
4. **Deployment Phase**: Archive change and update main specs
5. **Documentation Phase**: Specs serve as authoritative documentation

### Quick Reference

| Task | Command |
|------|---------|
| Create proposal | `/openspec:proposal` |
| List active changes | `openspec list` |
| List capabilities | `openspec list --specs` |
| View proposal | `openspec show [change-id]` |
| Validate proposal | `openspec validate [change-id] --strict` |
| Implement proposal | `/openspec:apply [change-id]` |
| Archive completed | `/openspec:archive [change-id]` |

For detailed instructions, see `openspec/AGENTS.md`.

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## Recent Changes (v0.3.8)
- **Markdown Link Security & Features** (Nov 2, 2025):
  - Fixed email links treated as internal links, changed color from teal to blue
  - Added dangerous protocol blocking (javascript:, data:, vbscript:, file://)
  - Fixed anchor-only links (#section) with smooth scrolling
  - Fixed heading slug generation (GitHub-compatible with unicode support)
  - Fixed email/tel tooltip cleanup (removes query parameters)
  - Created linkProtocols.ts utility for protocol validation
  - Memoized link extraction for performance optimization
  - Added 55 new tests (96.7% coverage for link features)
  - **Total: 1079 tests passing (60 test files)**
- **Version Display in Title Bar** (Nov 2, 2025):
  - Production builds show "ERFANA v{version}" in system title bar
  - Development builds show "ERFANA" (no version)
  - Uses Electron's app.getVersion() API
  - Added 9 comprehensive tests for window creation and title configuration
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

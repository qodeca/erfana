# Erfana Testing Documentation

Complete guide for testing Erfana. This covers both automated tests (Vitest/Playwright) and visual/manual testing using Circuit Electron MCP.

## 📚 Documentation Index

### Automated Tests (Unit/Integration)
- Runner: Vitest workspace (`main`, `preload`, `renderer`)
- Commands:
  - `npm run test` — run all projects once
  - `npm run test:renderer` — renderer tests
  - `npm run test:main` — main process tests
  - `npm run test:preload` — preload tests
- Run `npm run test` for current test count

#### Renderer tips
- When testing TerminalPanel in jsdom, mock xterm and addons to avoid canvas errors:
  - `vi.mock('@xterm/xterm', () => ({ Terminal: class { open(){} loadAddon(){} dispose(){} write(){} cols=80; rows=24 } }))`
  - `vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(){} } }))`
  - `vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss(){} dispose(){} } }))`
- Prefer dynamic import of `@xterm/addon-webgl` in code to keep tests happy

#### Notable Test Suites

**TerminalService** (`src/main/services/TerminalService.test.ts`)
- **18 comprehensive tests** covering terminal bootstrap pattern (v0.3.0)
- **Coverage**: 46% statements, 50% branch, 40% functions
- **Test Categories**:
  - Bootstrap script generation (3 tests)
  - Marker detection & clear handshake (4 tests)
  - Three-flag gating system (4 tests)
  - Environment filtering (3 tests)
  - Terminal operations (4 tests)
- Tests validate non-interactive terminal initialization, eliminating visible artifacts
- See [Terminal Documentation](../terminal.md) for implementation details

**TerminalPanel Scroll Fix** (`src/renderer/src/components/Panels/TerminalPanel.scroll.test.tsx`) **NEW in v0.3.1**
- **6 comprehensive tests** covering terminal scroll position preservation
- **Test Categories**:
  - Scroll-preserving options initialization
  - Position preservation when scrolled up
  - Auto-scroll when at bottom
  - Multiple consecutive writes tracking
  - Edge case handling (viewportY === baseY === 0)
  - Scroll options verification
- Tests validate fix for terminal jumping to top during Claude CLI streaming output
- Related GitHub issues: #826, #1413, #1426
- See [Terminal - Terminal Scroll Fix](../terminal.md#terminal-scroll-fix-v031)

**useTerminalStore AutoExecute** (`src/renderer/src/stores/useTerminalStore.autoExecute.test.ts`) **NEW in v0.3.3**
- **13 comprehensive tests** covering autoExecute functionality and race condition prevention
- **Test Categories**:
  - AutoExecute true/false behavior (2 tests)
  - Terminal initialization polling (1 test)
  - Error handling (terminal unavailable, write failures) (5 tests)
  - Timeout behaviors (autoExecute vs manual) (2 tests)
  - Concurrent calls and timing validation (3 tests)
- Tests validate Promise-based terminal writes with initialization polling
- Ensures Enter key is reliably sent after prompt paste in context menu actions
- See [Prompt Templates - Implementation Guide](../prompts/implementation.md)

**Prompt System** (`src/renderer/src/prompts/`) **NEW in v0.3.4**
- **319 comprehensive tests** covering the entire prompt template system
- **Coverage**: 98.59% statements, 96.59% branches, 100% functions, 98.59% lines
- **Test Organization**:

  *Core System Tests (177 tests)*:
  - `parser.test.ts` (31 tests) - YAML frontmatter parsing, validation, error handling
  - `renderer.test.ts` (32 tests) - CSP-safe Handlebars rendering, conditionals, helpers
  - `helpers.test.ts` (59 tests) - Utility functions (truncate, basename, dirname, formatLineRange)
  - `schema.test.ts` (29 tests) - Zod schema validation for template configuration
  - `registry.test.ts` (26 tests) - Template registry, filtering by area/subArea

  *UI Component Tests (75 tests)*:
  - `UserInputDialog.test.tsx` (31 tests) - Modal dialog, validation, keyboard shortcuts
  - `PreviewContextMenu.test.tsx` (20 tests) - Context menu rendering, prompt execution, icon mapping
  - `MarkdownPreview.prompt.test.tsx` (24 tests) - Integration tests for line tracking, markdown features, sanitization

  *Regression Tests (67 tests)*:
  - `prompt-command.test.ts` (32 tests) - New "Prompt" command feature validation
  - `existing-commands.test.ts` (35 tests) - Ensures Elaborate, Modify, Ask commands still work correctly

- **Test Utilities**:
  - `__test-utils__/fixtures.ts` - Factory functions for mock data (mockPromptVariables, mockPromptConfig, TEST_TEMPLATES)
  - `__test-utils__/mocks.ts` - Mock utilities (createMockWindowApi, installMockWindowApi, resetStores)

- **Key Testing Patterns**:
  - Factory functions for consistent test data generation
  - jsdom environment with portal-root for modal testing
  - Mock window.api and navigator.clipboard for IPC/clipboard operations
  - Component integration tests focused on structural rendering (not full E2E)
  - Regression tests to prevent breaking existing functionality

- Tests validate the complete prompt template system including YAML parsing, CSP-safe rendering, UI components, and context menu integration
- See [Prompt System Documentation](../prompts/) for implementation details

**Dialog System** (`src/renderer/src/components/Dialog/`, `src/renderer/src/utils/fileValidation.ts`) **NEW in v0.3.6**
- **129 comprehensive tests** covering unified dialog system and SOLID refactoring
- **Test Organization**:

  *Validation Tests (80 tests)*:
  - `fileValidation.test.ts` (80 tests) - File/folder name validation utilities
    - EMPTY, TOO_LONG, INVALID_CHARS validation (18 tests)
    - RESERVED names (Windows: CON, PRN, AUX, COM1-9, LPT1-9, etc.) (15 tests)
    - UNCHANGED validation for rename operations (8 tests)
    - DUPLICATE detection with case-insensitive matching (12 tests)
    - Dotfile edge cases (`.CON` valid, `CON` reserved) (8 tests)
    - Cross-platform compatibility (19 tests)

  *Component Tests (49 tests)*:
  - `FileSystemDialog.test.tsx` (49 tests) - Base component for file system operations
    - Rendering: Different icons (file/folder), operations (create/rename), labels (6 tests)
    - Focus: Auto-focus on mount, select-all for rename, no-select for create (3 tests)
    - Input: Character counter, whitespace trimming, 255 char limit (4 tests)
    - Validation: Error display, error classes, clearing errors on type (8 tests)
    - Button state: Disabled when empty/invalid, enabled when valid (3 tests)
    - Keyboard: Enter to submit, Esc to cancel (5 tests)
    - Handlers: Submit/cancel callbacks with correct values (6 tests)
    - Rename: CurrentName population, case-only changes allowed (2 tests)
    - Accessibility: ARIA attributes, tooltips, keyboard shortcuts info (3 tests)

  *Integration Tests*:
  - `WrapperDialogs.test.tsx` - NewFileDialog, NewFolderDialog, RenameDialog
    - Wrapper configuration: Icon selection (file vs folder), button labels
    - Validation messages: File-specific ("A file with this name already exists")
    - Cross-dialog consistency: Keyboard shortcuts, behavior patterns

- **Key Features Tested**:
  - Portal rendering with `#portal-root` (all dialogs)
  - Cross-platform validation (case-insensitive on macOS/Windows)
  - Windows reserved names (CON, PRN, AUX, COM1-9, LPT1-9)
  - Invalid characters: `/\?*:|"<>`
  - Dotfile edge cases (`.CON` valid, `CON` without dot reserved)
  - Auto-focus with select-all for rename operations
  - Character counter with 255 limit
  - Inline validation errors with error class styling
  - Submit button disabled when invalid/empty

- **SOLID Principles Applied**:
  - Single Responsibility: Validation (fileValidation.ts), base component (FileSystemDialog.tsx), wrappers
  - Open/Closed: Base component configurable via props, closed for modification
  - Dependency Inversion: Validation abstracted from UI components

- Tests validate SOLID refactoring of file system dialogs with comprehensive validation logic
- See [Architecture - Dialog System](../architecture.md#dialog-system) for implementation details

**Audio Transcription** (multiple files across `main/`, `renderer/`, `shared/`) **v0.7.3**
- **~4,000 lines of tests** covering the full transcription pipeline (spec 009)
- **Test Organization**:

  *Main process tests*:
  - `TranscriptionService.test.ts` (621 lines) – chunking, retry, progress, cancellation
  - `AudioMetadataService.test.ts` (314 lines) – duration, format, validation
  - `ApiKeyService.test.ts` (410 lines) – safeStorage encryption, cache, path traversal
  - `transcription-handlers.test.ts` (459 lines) – IPC handlers (import, cancel, validate, API key CRUD)
  - `AudioConverter.test.ts` (216 lines) – import pipeline converter

  *Renderer tests*:
  - `TranscriptionDialog.test.tsx` (465 lines) – dialog UI, progress, language selection, cancel
  - `useTranscriptionStore.test.ts` (341 lines) – Zustand store state management
  - `useImport.test.ts` (956 lines) – audio detection, routing, pre-validation

  *Shared tests*:
  - `transcription-schema.test.ts` (272 lines) – Zod schema validation for IPC contracts

- **Audio test fixtures**: `tests/fixtures/audio/` – speech recordings with known content for transcription accuracy verification (see [fixtures README](../../tests/fixtures/audio/README.md))

**ProjectTree Refactoring** (`src/renderer/src/hooks/*.logic.ts`, `src/renderer/src/components/ProjectTree/`) **v0.3.7**
- **320 comprehensive tests** covering ProjectTree modularization using "Extract Pure Logic" pattern
- Run `npm run test` for current test totals
- **Test Organization**:

  *Phase 1-2: P0 Critical Tests (147 tests)*:
  - `constants.test.ts` (10 tests) - ProjectTree constants (DRAG_DROP, TERMINAL, AUTO_SCROLL)
  - `switchHelpers.test.ts` (34 tests) - Project switching logic with terminal activity tracking
  - `withWatcherPause.test.ts` (17 tests) - Watcher pause/resume mechanism for file operations
  - `context-menu/commands.test.tsx` (65 tests) - 11 command classes (NewFileCommand, DeleteCommand, RenameCommand, etc.)
  - `context-menu/strategies.test.tsx` (15 tests) - Node-type strategies (FileStrategy, FolderStrategy)
  - `context-menu/factory.test.ts` (7 tests) - Strategy selection factory pattern

  *Phase 2.5a: Project Switching Tests (31 tests) – Issue #101*:
  - `ProjectService.switching.test.ts` (20 tests) - Main process switching orchestration
    - 016-FR-007 step ordering, AC-009 clear/load, AC-014 in-flight event drop
    - Session token bumping across DirectoryWatcherService and GitWatcherService
  - `ProjectTree.switching.test.tsx` (11 tests) - Renderer switching behavior
    - AC-009a tree clears, AC-009b new project loads, AC-009c stale events rejected
    - AC-009d git status updates, AC-014 in-flight events silently dropped

  *Phase 2.5: Pipeline & Hook Behavioral Tests (72 tests) – Spec T3-016 verification*:
  - `DirectoryWatcherService.pipeline.test.ts` (11 tests) - End-to-end directory pipeline integration
    - Uses real ThrottledWorker, EventCoalescer, AtomicSaveDetector wired to processEvents
    - Covers AC-001 (file creation), AC-002 (deletion), AC-003 (directory), AC-008 (coalescing), AC-013 (atomic save)
  - `GitWatcherService.pipeline.test.ts` (22 tests) - End-to-end git pipeline integration (#99)
    - Uses real GitEventCoalescer wired to handleCoalescedEvent (main process only)
    - Covers AC-004 (git add), AC-005 (git commit), AC-006 (git checkout), AC-018 (coalescer dedup)
    - Validates 150ms coalesce window, event deduplication, session token stale-event guard
    - Additional: all 5 event types, correlation ID, WatcherMetrics, disposal guards, circuit breaker
  - `WatcherResilience.test.ts` (14 tests) - Watcher resilience and polling fallback (#100)
    - AC-011 (polling fallback when watcher fails), AC-015 (redundant polling suppression), AC-016 (exponential backoff restart)
  - `useGitStatus.test.ts` visibility gating (5 tests) - Window visibility gating (#102)
    - AC-012: drops git status refreshes while hidden (watcher, polling, directory-change sources), single catch-up on restore, cooldown respected
  - `ThrottledWorker.test.ts` overflow (6 tests) - Event buffer overflow at production scale (#102)
    - AC-017: 30,000-event cap, FIFO eviction, correct overflow reporting, no crash/hang, post-burst recovery
  - `useDirectoryWatcher.test.ts` (11 tests) - Hook behavioral tests
    - Event handling, AC-010 internal operation suppression, lifecycle, subscriptions
  - `ProjectTree.timing.test.tsx` (3 tests) - Project switching timing and manual refresh (AC-007)

  *Phase 3: P1 Hook Logic Tests (173 tests) - "Extract Pure Logic" Pattern*:
  - `useDirectoryWatcher.logic.ts + .test.ts` (23 tests, 5 pure functions)
    - State guards, message creation, error handling
  - `useProjectManagement.logic.ts + .test.ts` (71 tests, 25 pure functions)
    - Path utilities, validation, state guards, message creators, error formatters
  - `useFileOperations.logic.ts + .test.ts` (79 tests, 27 pure functions)
    - Path logic, sibling extraction, message creation, error handling/detection

- **Pure Functions Extracted**: 57 total across 3 hooks
  - Path manipulation, validation, duplicate detection
  - Message creation for user feedback
  - Error handling, detection, formatting
  - All deterministic with no side effects

- **"Extract Pure Logic" Pattern Benefits**:
  - **Fast**: 173 pure logic tests run in ~24ms (no React rendering overhead)
  - **Deterministic**: No async race conditions or timing issues
  - **Portable**: Works in any test environment (no jsdom/React 18 conflicts)
  - **Better Design**: Pure logic separated from React effects/hooks
  - **Easier Debugging**: Simple function inputs/outputs, no hidden state
  - **Maintainable**: Centralized, testable logic easy to understand

- **Key Features Tested**:
  - Project management: Load, open, close, refresh operations with error handling
  - File operations: Create, rename, delete files/folders with validation
  - Directory watching: Start, stop, error recovery, state guards
  - Context menu: Command pattern, strategy selection, factory logic
  - Watcher synchronization: Pause during operations, resume after completion

- **Pattern Application**:
  1. Identify complex hooks with business logic embedded in React effects
  2. Extract pure functions to separate `.logic.ts` file (deterministic, no side effects)
  3. Create comprehensive tests in `.logic.test.ts` (fast, independent)
  4. Refactor hooks to use pure functions (cleaner, more testable)
  5. Result: Zero breaking changes, dramatically improved testability

- See [Architecture - ProjectTree Modularization](../architecture.md#projecttree-modularization) for implementation details

---

### E2E/UI (Playwright Electron)

**[e2e-testing.md](./e2e-testing.md)** - Comprehensive E2E testing guide

- Playwright setup and configuration for Electron
- Testing patterns for third-party components (Monaco, xterm.js, Mermaid)
- Complete selector catalog (211 testids) – see [e2e-selectors.md](./e2e-selectors.md)
- Test helper utilities documentation
- Troubleshooting guide

**E2E test files** (`e2e/`):
- `app-launch.e2e.ts` – Application launch, activity bar, welcome panel visibility
- `third-party-components.e2e.ts` – Monaco editor, xterm.js terminal, Mermaid diagrams
- `directory-watcher.e2e.ts` – Directory watcher pipeline (#104): verifies file creation via terminal appears in Project Tree within latency budget
- `audio-transcription.e2e.ts` – Full audio import transcription lifecycle (real OpenAI API, requires `OPENAI_API_KEY`, skips if not set)

**Shared helpers** (`e2e/utils/helpers.ts`):
- `createTestProject(seedFiles?)` – Creates temp project directory with optional seed files, returns `{ projectPath, cleanup }`
- `createTempUserDataDir(prefix)` – Creates isolated Electron user data directory, returns `{ userDataDir, cleanup }`
- `waitForAppReady`, `openProject`, `closeApp` – App lifecycle helpers
- `byTestId`, `waitForTestId`, `waitForTestIdHidden` – Element location helpers
- See [E2E Helpers](./e2e-helpers.md) for full reference

See Spec #011 (archived) for the specification.

### Coverage
- Generate per-project coverage reports: `npm run test:cov`
- Reports written under `coverage/<project>/` (lcov + HTML)
- Build outputs (`out/`) are excluded from coverage to keep signal clean
- Initial thresholds are low (10%) to avoid blocking early adoption

---

### Visual/MCP Test Scenarios

**[test-scenarios.md](./test-scenarios.md)** - 10 comprehensive test scenarios

**UI Verification** (1-5):
- Application launch & UI verification
- File tree navigation
- Markdown formatting toolbar
- View mode switching
- Auto-save functionality

**Interaction Tests** (6-10):
- Keyboard shortcuts
- Context menu operations
- Multi-file tabs
- Document statistics
- Panel protection

**Perfect for:** Verifying UI and testing user interactions with Circuit Electron MCP

---

## 🚀 Recommended Workflows

### After Making Code Changes
1. Unit tests: `npm run test`
2. Run relevant scenarios from [test-scenarios.md](./test-scenarios.md)
3. Optionally: build `npm run build` for full-package checks

### Comprehensive Testing
1. Run unit/integration tests (Vitest)
2. Run E2E tests: `npm run test:e2e`
3. Run visual scenarios in [test-scenarios.md](./test-scenarios.md)

### Learning Circuit Electron MCP
1. Start with simple flows from [test-scenarios.md](./test-scenarios.md)
2. Use screenshots to debug visually

---

## 🎯 Testing Capabilities

Circuit Electron MCP enables Claude Code to:
- ✅ Launch Erfana and capture screenshots
- ✅ Interact with UI (click, type, keyboard shortcuts)
- ✅ Verify functionality visually and programmatically
- ✅ Test after code changes without manual inspection
- ✅ Run automated test scenarios
- ✅ Debug issues with visual feedback

---

## 📋 Prerequisites

For unit/integration:
1. Install dev deps: `npm i -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom`
2. Run tests: `npm run test`

For MCP visual testing:
1. Build: `npm run build`
2. Circuit Electron MCP configured in `.mcp.json`

---

## See Also

- [E2E Testing Guide](./e2e-testing.md) - Playwright E2E testing documentation
- [Test Scenarios](./test-scenarios.md) - Visual/MCP test scenarios
- [Development Tasks](../development-tasks.md) - Common development patterns
- [Architecture](../architecture.md) - Application structure
- [UI Components](../ui-components.md) - UI system details
- Spec #011 (archived) – UI testing compatibility specification

---

## 💡 Examples

### Unit Tests
- Renderer tests: `src/renderer/src/**/*.test.tsx`
- Prompt system tests: `src/renderer/src/prompts/*.test.ts` and `src/renderer/src/prompts/*.test.tsx`
- Test utilities: `src/renderer/src/prompts/__test-utils__/` (fixtures, mocks)

### Visual/MCP Tests
- Follow flows in [test-scenarios.md](./test-scenarios.md)

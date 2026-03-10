# Requirements

## Workstream 1: Page Object Model migration

### Functional requirements

**018-FR-001: TerminalPage class**
Extract all terminal-related helpers (`terminal.open()`, `close()`, `focus()`, `sendCommand()`, `waitForOutput()`, `interrupt()`, `clear()`, `scrollToBottom()`, `restart()`, `toggleScrollLock()`) into a `TerminalPage` class that accepts a Playwright `Page` instance in its constructor. The class must expose the same public API as the current namespace, enabling a non-breaking migration path.

**018-FR-002: MonacoPage class**
Extract all Monaco editor helpers (`monaco.getEditor()`, `focus()`, `setContent()`, `appendContent()`, `getContent()`, `selectAll()`, `openCommandPalette()`, `executeCommand()`, `openSearch()`, `closeSearch()`, `search()`, `nextMatch()`, `prevMatch()`, `waitForReady()`, `getTextArea()`, `waitForCursor()`) into a `MonacoPage` class. The class must encapsulate editor state (e.g., cached textarea reference) as instance properties rather than module-level variables.

**018-FR-003: MermaidPage class**
Extract all Mermaid diagram helpers (`mermaid.hoverDiagram()`, `setDirection()`, `openViewer()`, `closeViewer()`, `zoomIn()`, `zoomOut()`, `fitToView()`, `resetZoom()`, `openChat()`, `sendChatMessage()`) into a `MermaidPage` class. The class must accept a `Page` instance in its constructor and provide chainable methods where semantically appropriate.

**018-FR-004: ProjectTreePage class**
Extract project tree helpers (`clickFileInTree()`, `clickFileByName()`, `toggleFolder()`, `openProject()`, `openProjectViaUI()`) into a `ProjectTreePage` class. The class must support dynamic test ID resolution using the existing `getDynamicTestId()` pattern for file path-based selectors.

**018-FR-005: KeyboardHelper class**
Extract keyboard helpers (`keyboard.shortcut()`, `selectAll()`, `copy()`, `paste()`, `cut()`, `undo()`, `redo()`, `save()`, `find()`, `newWindow()`) into a `KeyboardHelper` class with platform detection as a constructor parameter (or auto-detected). The class must be usable standalone or composed into other POM classes.

**018-FR-006: POM file organization**
Organize POM classes into `e2e/pages/` directory with one file per class: `terminal.page.ts`, `monaco.page.ts`, `mermaid.page.ts`, `project-tree.page.ts`, `keyboard.helper.ts`. Export all classes from `e2e/pages/index.ts`. The existing `e2e/utils/helpers.ts` must re-export POM classes for backward compatibility during migration.

## Workstream 2: Playwright fixture promotion

### Functional requirements

**018-FR-007: testProject fixture**
Promote `createTestProject()` to a worker-scoped Playwright fixture named `testProject` that automatically creates a temporary project directory with seed markdown files before each worker, provides the project path to tests, and cleans up the directory after the worker completes. The fixture must support configurable seed files via fixture options.

**018-FR-008: withSettings fixture**
Create a test-scoped fixture named `withSettings` that accepts a partial settings object, writes it to the test project's `.erfana/settings.json` before the test, and restores original settings after the test. This enables tests to declaratively configure project settings without manual file manipulation.

**018-FR-009: withOpenFile fixture**
Create a test-scoped fixture named `withOpenFile` that accepts a file path (relative to the test project), opens the file in the editor, waits for Monaco readiness, and provides the `MonacoPage` instance to the test. This eliminates the common setup boilerplate of opening a file and waiting for the editor across many test scenarios.

**018-FR-010: POM fixtures**
Register all POM classes as Playwright fixtures (`terminalPage`, `monacoPage`, `mermaidPage`, `projectTreePage`, `keyboardHelper`) so they are automatically instantiated with the current `Page` and available via destructuring in test functions. This follows Playwright's recommended fixture composition pattern.

## Workstream 3: Condition-based waits

### Functional requirements

**018-FR-011: Shell prompt detection for terminal**
Replace terminal-related `waitForTimeout()` calls (currently 1000–1500ms for PTY initialization) with a condition-based wait that detects the shell prompt character (`$`, `%`, `#`, or `>`). The detection must support configurable prompt patterns and a maximum timeout fallback (default 10s).

**018-FR-012: Monaco content readiness wait**
Replace any editor-related fixed waits with a condition-based check that verifies Monaco's internal textarea is focused and the editor model is loaded. This builds on the existing `waitForReady()` helper but must be the single source of truth for "editor is ready for input."

**018-FR-013: IPC roundtrip wait helper**
Create a `waitForIpcComplete()` helper that waits for a UI state change confirming an IPC operation completed (e.g., file saved -> title bar updated, project opened -> tree populated). This replaces any `waitForTimeout()` calls used to "wait for IPC to finish" with deterministic UI-based assertions.

### Non-functional requirements

**018-NFR-001: Zero-breakage migration**
All 5 existing E2E test files must pass without modification after POM migration. The migration must be backward-compatible – existing imports from `helpers.ts` must continue to work via re-exports.

**018-NFR-002: No fixed waits in assertion paths**
After migration, zero `waitForTimeout()` calls may exist in any assertion path (i.e., between an action and its verification). Fixed waits are only permitted as a documented last resort for external process startup (e.g., FFmpeg) with a `// KNOWN_WAIT:` comment explaining why.

**018-NFR-003: POM composability**
POM classes must be composable – a `MonacoPage` instance must be usable alongside a `TerminalPage` instance in the same test without conflicts. Each class must operate only on its own DOM region.

**018-NFR-004: Fixture isolation**
Fixtures must not leak state between tests. Worker-scoped fixtures (`testProject`, `userDataDir`) must create isolated directories per worker. Test-scoped fixtures (`withSettings`, `withOpenFile`) must restore original state on teardown.

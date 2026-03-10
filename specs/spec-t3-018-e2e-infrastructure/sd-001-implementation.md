# Solution design – E2E infrastructure overhaul implementation

> Spec #018 - Sequence: 001
> Created: 2026-03-10

## Overview

Decompose the monolithic `e2e/utils/helpers.ts` (1,176 lines) into Page Object Model classes in `e2e/pages/`, restructure fixtures from `e2e/fixtures.ts` into `e2e/fixtures/`, replace 13 `waitForTimeout` calls with condition-based waits, and maintain full backward compatibility through a thin adapter layer in `helpers.ts`.

The implementation follows the architecture.md vertical-slice sequence (6 slices), where each slice is independently mergeable with all existing tests passing.

## Implementation steps

### Step 1: Create `e2e/pages/keyboard.helper.ts` (Slice 1)

**File**: `e2e/pages/keyboard.helper.ts` (CREATE)

Extract the `keyboard` namespace from `helpers.ts` (L209-L297) into a `KeyboardHelper` class:

- Constructor takes `Page`, caches platform modifier on first `getModifier()` call
- 11 methods: `getModifier()`, `shortcut()`, `selectAll()`, `copy()`, `paste()`, `cut()`, `undo()`, `redo()`, `save()`, `find()`, `newWindow()`
- No dependencies on other POM classes
- The `detectPlatform()` private function moves inside the class

Key pattern: Instance caches modifier string in a private field (eliminates repeated `page.evaluate()` calls that the current namespace pattern makes on every shortcut).

### Step 2: Create `e2e/pages/terminal.page.ts` (Slice 2)

**File**: `e2e/pages/terminal.page.ts` (CREATE)

Extract the `terminal` namespace from `helpers.ts` (L501-L642) into a `TerminalPage` class:

- Constructor takes `Page`
- 12 methods: `getTerminal()`, `open()`, `close()`, `focus()`, `sendCommand()`, `waitForOutput()`, `interrupt()`, `clear()`, `scrollToBottom()`, `restart()`, `toggleScrollLock()`, `waitForReady()` plus new `waitForPrompt()`
- **Wait replacements in this step**:
  - Wait #1 (L523, 1500ms PTY init in `open()` when already visible) -- replace with `waitForPrompt()`
  - Wait #2 (L537, 500ms animation in `open()`) -- remove entirely, `toBeVisible()` auto-retries
  - Wait #3 (L545, 1500ms PTY init in `open()` after button click) -- replace with `waitForPrompt()`
  - Wait #4 (L562, 100ms in `focus()`) -- replace with `waitForFunction()` checking `document.activeElement` matches xterm textarea
  - Wait #5 (L625, 1000ms in `restart()`) -- replace with `waitForPrompt()`
  - Wait #6 (L641, 1000ms in `waitForReady()`) -- replace with `waitForPrompt()`

`waitForPrompt()` implementation per architecture.md section 2: uses `page.waitForFunction()` to poll `.xterm-rows` textContent, checks last non-empty line against configurable regex patterns (default: `/[\w@:~\-/.]+[$%]\s*$/` and `/^#\s*$/`). On timeout, captures terminal content for debug output.

### Step 3: Create `e2e/pages/mermaid.page.ts` (Slice 3)

**File**: `e2e/pages/mermaid.page.ts` (CREATE)

Extract the `mermaid` namespace from `helpers.ts` (L663-L766) into a `MermaidPage` class:

- Constructor takes `Page`
- 12 methods: `getToolbar()`, `getViewer()`, `hoverDiagram()`, `setDirection()`, `openViewer()`, `closeViewer()`, `zoomIn()`, `zoomOut()`, `fitToView()`, `resetZoom()`, `openChat()`, `sendChatMessage()`
- No wait replacements within the POM itself (mermaid helper methods already use condition-based waits like `waitForTestId`)
- Test file wait replacements deferred to Slice 6

### Step 4: Create `e2e/pages/project-tree.page.ts` (Slice 4a)

**File**: `e2e/pages/project-tree.page.ts` (CREATE)

Extract standalone project tree functions from `helpers.ts` into a `ProjectTreePage` class:

- Constructor takes `Page`
- 6 methods: `openProjectTree()`, `clickFileInTree()`, `clickFileByName()`, `toggleFolder()`, `openProject()`, `openProjectViaUI()`
- `openProject()` and `openProjectViaUI()` take `ElectronApplication` as a method parameter (needed for `stubDialog`), not a constructor dependency
- Uses `byDynamicTestId()` and `getPathHash()` internally (import from helpers or inline)

### Step 5: Create `e2e/pages/monaco.page.ts` (Slice 5 - partial)

**File**: `e2e/pages/monaco.page.ts` (CREATE)

Extract the `monaco` namespace from `helpers.ts` (L319-L480) into a `MonacoPage` class:

- Constructor takes `Page` and `KeyboardHelper` (DIP trade-off: concrete dependency, not interface)
- 16 methods: `getEditor()`, `focus()`, `setContent()`, `appendContent()`, `getContent()`, `selectAll()`, `openCommandPalette()`, `executeCommand()`, `openSearch()`, `closeSearch()`, `search()`, `nextMatch()`, `prevMatch()`, `waitForReady()`, `getTextArea()`, `waitForCursor()`
- Internal `keyboard` calls use the injected `KeyboardHelper` instance instead of the module-level `keyboard` namespace
- No wait replacements needed (Monaco methods already use condition-based waits)

### Step 6: Create `e2e/pages/index.ts` barrel export

**File**: `e2e/pages/index.ts` (CREATE)

```typescript
export { KeyboardHelper } from './keyboard.helper'
export { TerminalPage } from './terminal.page'
export { MonacoPage } from './monaco.page'
export { MermaidPage } from './mermaid.page'
export { ProjectTreePage } from './project-tree.page'
```

### Step 7: Create `e2e/utils/wait-helpers.ts`

**File**: `e2e/utils/wait-helpers.ts` (CREATE)

Implements `waitForIpcComplete()` per architecture.md section 4.4:
- Accepts `page`, `indicator` (test ID string or Locator), optional `trigger` function, and `timeout`
- If trigger provided, runs trigger and wait in parallel via `Promise.all` to avoid race conditions
- Cross-cutting utility, not bound to any single POM

### Step 8: Rewrite `e2e/utils/helpers.ts` as backward-compatibility adapter

**File**: `e2e/utils/helpers.ts` (MODIFY)

Transform from monolithic module into a thin adapter layer:

- Import all POM classes from `../pages`
- Create WeakMap caches per POM class (`keyboardCache`, `terminalCache`, `monacoCache`, `mermaidCache`)
- Re-export `keyboard`, `monaco`, `terminal`, `mermaid` namespaces where each method instantiates (or retrieves cached) POM and delegates
- Preserve all standalone function exports: `byTestId`, `byDynamicTestId`, `waitForTestId`, `waitForTestIdHidden`, `getAllTestIds`, `verifyUniqueTestIds`, `waitForAppReady`, `openProjectTree`, `openSettings`, `closeSettings`, `clickFileInTree`, `toggleFolder`, `clickFileByName`, `openProject`, `openProjectViaUI`, `dismissDialogIfPresent`, `closeApp`, `createTestProject`, `createTempUserDataDir`
- Re-export `TEST_IDS`, `getPathHash`
- Standalone functions that move to `ProjectTreePage` (like `openProject`, `openProjectViaUI`, `clickFileByName`) remain exported as standalone functions that delegate to a cached `ProjectTreePage` instance, OR remain as-is (they don't take `this` context). Decision: keep standalone functions as-is in helpers.ts since they use `ElectronApplication` which is awkward in POM constructors. The `ProjectTreePage` class provides the new API; helpers.ts keeps the old API.

**Critical**: All 4 test files import from `./utils/helpers` -- they must continue working without any import changes.

### Step 9: Create `e2e/fixtures/app.fixtures.ts` (Slice 4b)

**File**: `e2e/fixtures/app.fixtures.ts` (CREATE)

Move `userDataDir`, `app`, `window`, `appWithProject`, `windowWithProject` from `e2e/fixtures.ts`:

- `userDataDir` remains worker-scoped
- `app` teardown uses `closeApp()` instead of bare `electronApp.close()` to handle quit dialogs
- `appWithProject` uses `testProject` path instead of `DEFAULT_TEST_PROJECT`
- Export `base` for fixture chaining
- Preserve `testMultiWindow` as-is (currently unused, kept for compatibility)

### Step 10: Create `e2e/fixtures/project.fixtures.ts` (Slice 4b)

**File**: `e2e/fixtures/project.fixtures.ts` (CREATE)

New fixtures:

- `testProject`: test-scoped (not worker-scoped per architecture.md rationale -- tests mutate project dirs). Creates temp dir with seed files via `createTestProject()`. Provides `{ path, cleanup }`. Cleanup in teardown.
- `withSettings`: option fixture. Accepts partial settings object. Writes `.erfana/settings.json` before test, restores original on teardown. No-op if not requested.

### Step 11: Create `e2e/fixtures/pom.fixtures.ts` (Slice 5)

**File**: `e2e/fixtures/pom.fixtures.ts` (CREATE)

Register POM classes as fixtures:

```typescript
keyboardHelper: async ({ window }, use) => { await use(new KeyboardHelper(window)) }
terminalPage: async ({ window }, use) => { await use(new TerminalPage(window)) }
monacoPage: async ({ window, keyboardHelper }, use) => { await use(new MonacoPage(window, keyboardHelper)) }
mermaidPage: async ({ window }, use) => { await use(new MermaidPage(window)) }
projectTreePage: async ({ window }, use) => { await use(new ProjectTreePage(window)) }
```

### Step 12: Create `e2e/fixtures/editor.fixtures.ts` (Slice 5)

**File**: `e2e/fixtures/editor.fixtures.ts` (CREATE)

- `withOpenFile`: option fixture. Accepts filename string or `{ path, mode }` object. Uses `projectTreePage.clickFileByName()` to navigate, then `monacoPage.waitForReady()` (skip if mode is `'preview'`). Yields `monacoPage` to test.

### Step 13: Create `e2e/fixtures/index.ts` composed test export (Slice 4b/5)

**File**: `e2e/fixtures/index.ts` (CREATE)

Chain order per architecture.md section 3:
1. App fixtures (userDataDir, app, window)
2. Project fixtures (testProject, appWithProject, windowWithProject, withSettings)
3. POM fixtures (keyboardHelper, monacoPage, terminalPage, mermaidPage, projectTreePage)
4. Editor fixtures (withOpenFile)

Re-export `expect` from `@playwright/test`.

### Step 14: Update `e2e/fixtures.ts` to re-export from new structure

**File**: `e2e/fixtures.ts` (MODIFY)

Make it a thin re-export from `./fixtures/index` for any code that imports from the old path:

```typescript
export { test, expect } from './fixtures/index'
export { testMultiWindow } from './fixtures/app.fixtures'
// ... other re-exports for backward compatibility
```

### Step 15: Annotate KNOWN_WAIT comments (Slice 6b)

**Files**: `e2e/utils/helpers.ts`, `e2e/fixtures/app.fixtures.ts`, `e2e/app-launch.e2e.ts` (MODIFY)

Add `// KNOWN_WAIT:` annotations to the 6 `setTimeout` calls in teardown/setup paths that are not being replaced:

| Location | Annotation |
|----------|------------|
| `closeApp()` ~L1064 | `// KNOWN_WAIT: electron-log flush before close` |
| `closeApp()` ~L1109 | `// KNOWN_WAIT: electron-log flush before close` |
| `app.fixtures.ts` app teardown | `// KNOWN_WAIT: electron-log flush before close` |
| `app.fixtures.ts` multi-window teardown | `// KNOWN_WAIT: electron-log flush before close` |
| `app-launch.e2e.ts` ~L38 | `// KNOWN_WAIT: electron-log flush before close` |
| `app-launch.e2e.ts` ~L71 | `// KNOWN_WAIT: electron-log flush before close` |

And annotate Wait #13 (300ms in `closeApp()` dialog loop):
`// KNOWN_WAIT: Inter-dialog pause during quit -- page may be destroyed`

### Step 16: Replace test file waitForTimeout calls (Slice 6a/6b)

**File**: `e2e/third-party-components.e2e.ts` (MODIFY)

Replace 6 `waitForTimeout` calls:

| Line | Current | Replacement |
|------|---------|-------------|
| ~L154 | 1500ms term init | Remove -- `terminal.open()` now includes `waitForPrompt()` |
| ~L162 | 1000ms cmd exec | `terminal.waitForOutput(window, 'E2E Terminal Test')` |
| ~L206 | 500ms preview load | `waitForTestId(window, TEST_IDS.EDITOR_PREVIEW)` |
| ~L213 | 2000ms mermaid render | `previewPane.locator('.mermaid-container svg').waitFor({ timeout: 10000 })` |
| ~L224 | 300ms toolbar transition | Remove -- `hoverDiagram()` already includes `waitForTestId(MERMAID_TOOLBAR)` |
| ~L242 | 1000ms direction re-render | `previewPane.locator('.mermaid-container svg').waitFor()` after click |

### Step 17: Update documentation

**File**: `docs/testing/e2e-helpers.md` (CREATE or MODIFY)

Document:
- POM class overview with constructor signatures
- Fixture composition graph
- Migration guide (old namespace API to new POM/fixture API)
- Wait replacement rationale
- `KNOWN_WAIT` annotation convention

## Test strategy

### Coverage target: >80%

### Test types
- **Functional E2E**: All 4 existing test files must pass without modification (backward compatibility gate)
- **Smoke verification**: After each slice, run `npm run test:e2e` to confirm no regressions

### Key scenarios mapped to acceptance criteria

| AC | Scenario | Verification |
|----|----------|-------------|
| AC-001 | POM instantiation | `terminalPage` fixture provides TerminalPage instance with all methods |
| AC-002 | Backward compat | `npm run test:e2e` passes without modifying test files |
| AC-003 | File structure | `e2e/pages/` contains all 6 files (5 classes + index.ts) |
| AC-004 | testProject lifecycle | Temp dir created per test, cleaned up on teardown |
| AC-005 | withSettings | Settings written before test, restored after |
| AC-006 | withOpenFile | Monaco ready with file content loaded |
| AC-007 | waitForPrompt | Resolves on prompt character, no setTimeout internally |
| AC-008 | No residual waits | `grep -r 'waitForTimeout' e2e/` returns 0 in assertion paths |

### Test files
- No new test files for the infrastructure itself (it is tested by existing E2E tests passing)
- The 4 existing test files serve as the regression test suite

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `waitForPrompt()` unreliable in CI (different shell prompt format) | Medium | High | Configurable patterns + 10s timeout fallback; `KNOWN_WAIT` annotation if specific wait proves flaky |
| WeakMap adapter masks bugs (cached POM with stale page) | Medium | Low | WeakMap keys are Page objects; when Page is closed, entries are GC'd. Each test gets a fresh Page from fixtures |
| Fixture chain too deep (slow startup) | Low | Medium | Worker-scoped `userDataDir` amortizes setup; test-scoped `testProject` is cheap (<10ms) |
| `openProject`/`openProjectViaUI` awkward in ProjectTreePage (need ElectronApplication) | Medium | Low | Keep as standalone functions in helpers.ts; ProjectTreePage only has tree navigation methods |
| xterm DOM structure changes | Low | High | `waitForPrompt()` uses `.xterm-rows` (accessibility layer); pin xterm.js version |

## Estimates

| Metric | Value |
|--------|-------|
| Complexity | Medium |
| Files affected | 8 (existing) |
| New files | 10 |
| Test files | 0 (existing tests serve as regression) |

## Verification criteria

1. `npm run test:e2e` passes with 0 failures (all 4 test files)
2. `npm run typecheck` passes cleanly
3. `e2e/pages/` directory contains: `index.ts`, `keyboard.helper.ts`, `terminal.page.ts`, `monaco.page.ts`, `mermaid.page.ts`, `project-tree.page.ts`
4. `e2e/fixtures/` directory contains: `index.ts`, `app.fixtures.ts`, `project.fixtures.ts`, `pom.fixtures.ts`, `editor.fixtures.ts`
5. `grep -rn 'waitForTimeout' e2e/` returns 0 matches in assertion paths (only `KNOWN_WAIT` annotated calls in teardown paths)
6. All imports from `e2e/utils/helpers` resolve correctly (backward compat)
7. POM classes composable -- `MonacoPage` and `TerminalPage` usable in same test without conflicts

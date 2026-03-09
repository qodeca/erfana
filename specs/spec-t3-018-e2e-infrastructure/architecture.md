# Architecture design – E2E infrastructure overhaul

> Spec #018 · T3 Lite · Status: draft
> Created: 2026-03-09

## 1. File organization

```
e2e/
├── pages/                        # POM classes
│   ├── index.ts                  # Barrel export
│   ├── keyboard.helper.ts        # KeyboardHelper
│   ├── terminal.page.ts          # TerminalPage
│   ├── monaco.page.ts            # MonacoPage
│   ├── mermaid.page.ts           # MermaidPage
│   └── project-tree.page.ts      # ProjectTreePage
├── fixtures/                     # Playwright fixtures (decomposed from fixtures.ts)
│   ├── index.ts                  # Composed test export merging all fixture sets
│   ├── app.fixtures.ts           # userDataDir, app, window (from current fixtures.ts)
│   ├── project.fixtures.ts       # testProject, withSettings
│   ├── editor.fixtures.ts        # withOpenFile
│   └── pom.fixtures.ts           # keyboardHelper, monacoPage, terminalPage, etc.
├── utils/
│   ├── helpers.ts                # Backward-compat re-exports (thin adapter)
│   └── wait-helpers.ts           # Cross-cutting wait utilities (waitForIpcComplete)
└── *.e2e.ts                      # Test files (unchanged initially)
```

Key decisions:

- **Separate `pages/` and `fixtures/`**: POM classes are pure (no Playwright test runner dependency), fixtures wire them into the test lifecycle. This separation enables unit-testing POMs if needed and keeps fixture files focused on lifecycle management.
- **Barrel exports**: `pages/index.ts` and `fixtures/index.ts` provide clean import paths. Test files import from `./fixtures` (for the composed `test` object) or `./pages` (for type references).
- **`utils/helpers.ts` preserved**: Existing test files continue to work without modification during migration. The file becomes a thin adapter layer (see section 5).
- **`utils/wait-helpers.ts` added**: Cross-cutting wait utilities that don't belong to any single POM (see section 4.4).

## 2. POM class hierarchy

All POM classes take `Page` in constructor. Only `MonacoPage` has a second dependency (`KeyboardHelper`).

| Class | Constructor | Dependencies | Method count | Source in helpers.ts |
|---|---|---|---|---|
| `KeyboardHelper` | `(page: Page)` | None | 11 | `keyboard` namespace (L1–L120) |
| `TerminalPage` | `(page: Page)` | None | 12 (adds `waitForPrompt()`) | `terminal` namespace (L480–L690) |
| `MonacoPage` | `(page: Page, keyboard: KeyboardHelper)` | `KeyboardHelper` | 16 | `monaco` namespace (L122–L478) |
| `MermaidPage` | `(page: Page)` | None | 12 | `mermaid` namespace (L692–L900) |
| `ProjectTreePage` | `(page: Page)` | None | 6 | Standalone: `openProject`, `openProjectViaUI`, tree nav functions |

### Design principles

- **Stateful instances, not static namespaces**: Each POM holds a `page` reference, eliminating the need to pass `page` to every method call. This is the core improvement over the current namespace pattern.
- **`KeyboardHelper` caches platform modifier**: After the first `navigator.platform` check (renderer-safe), the result is cached in an instance field. This eliminates redundant IPC per keyboard shortcut – currently every `keyboard.*` call re-evaluates platform.
- **`TerminalPage.waitForPrompt()`**: New method not present in current helpers. Uses `page.waitForFunction()` to poll the terminal container's `textContent` for shell prompt patterns at end of last non-empty line. Default patterns match standard zsh (`%`) and bash (`$`) prompts with username prefix, plus a separate root prompt pattern (`#` as sole character). This works because xterm.js maintains a DOM accessibility layer (`.xterm-rows` with spans) even with the WebGL renderer – confirmed by existing `terminal.waitForOutput()` using `toContainText()` successfully.
- **DIP trade-off**: `MonacoPage` takes concrete `KeyboardHelper` rather than an interface. An interface adds ceremony without proportional benefit in test-only code.
- **Naming convention**: `.page.ts` for POMs targeting specific UI regions, `.helper.ts` for cross-cutting utilities. Both live in `pages/`.

### Class sketch – `KeyboardHelper`

```typescript
export class KeyboardHelper {
  private modifier: string | null = null

  constructor(private readonly page: Page) {}

  async getModifier(): Promise<string> {
    if (!this.modifier) {
      // Matches existing helpers.ts detectPlatform() – uses navigator (renderer-safe)
      const platform = await this.page.evaluate(() => navigator.platform)
      this.modifier = platform.startsWith('Mac') ? 'Meta' : 'Control'
    }
    return this.modifier
  }

  async selectAll() {
    const mod = await this.getModifier()
    await this.page.keyboard.press(`${mod}+a`)
  }

  // ... remaining 10 methods follow same pattern
}
```

### Class sketch – `TerminalPage.waitForPrompt()`

```typescript
async waitForPrompt(options?: { timeout?: number; patterns?: RegExp[] }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  const patterns = options?.patterns ?? [/[\w@:~\-/.]+[$%]\s*$/, /^#\s*$/]

  try {
    await this.page.waitForFunction(
      ({ selector, patterns: pats }) => {
        const el = document.querySelector(selector)
        if (!el?.textContent) return false
        const lines = el.textContent.split('\n').filter(l => l.trim())
        const lastLine = lines[lines.length - 1] ?? ''
        return pats.some(p => new RegExp(p.source, p.flags).test(lastLine))
      },
      {
        selector: '.xterm-rows',
        patterns: patterns.map(p => ({ source: p.source, flags: p.flags })),
      },
      { timeout }
    )
  } catch (error) {
    const content = await this.page.locator('.xterm-rows').textContent().catch(() => '<unavailable>')
    throw new Error(`waitForPrompt timed out after ${timeout}ms.\nTerminal content:\n${content}`, { cause: error })
  }
}
```

Key design decisions for `waitForPrompt()`:

- **Default patterns**: `/[\w@:~\-/.]+[$%]\s*$/` matches standard bash (`user@host:~/dir$`) and zsh (`user@host ~/dir%`) prompts. The `\w` prefix requirement prevents false positives on output lines containing `$` or `%` (e.g., currency values, shell variables).
- **Root prompt**: `/^#\s*$/` is separate – only matches `#` when it's the sole character on the line, avoiding false positives on comment lines or output containing `#`.
- **Regex serialization**: Patterns are serialized as `{ source, flags }` objects (not bare `.source` strings) to preserve regex flags across the `page.evaluate()` boundary.
- **Timeout error includes terminal content**: On failure, captures `.xterm-rows` textContent and includes it in the error message. This makes debugging CI failures significantly easier – you can see what the terminal actually showed.
- **Customizable patterns**: Tests with non-standard prompts can pass their own regex array.

## 3. Fixture composition graph

```
Worker-scoped:
  userDataDir ──┐    (creates temp dir per worker, cleans up after)
                │
Test-scoped:    │
  testProject ──┤    (copies seed project into fresh subdir per test)
  app ←─────────┘ userDataDir
  window ← app
  keyboardHelper ← window
  terminalPage ← window
  monacoPage ← window + keyboardHelper
  mermaidPage ← window
  projectTreePage ← window
  appWithProject ← userDataDir + testProject
  windowWithProject ← appWithProject
  withSettings ← testProject (writes .erfana/settings.json, restores after)
  withOpenFile ← windowWithProject + projectTreePage + monacoPage
```

Scoping rationale:

- **`userDataDir` remains worker-scoped**: Electron user data (settings, caches) is safe to share across tests in the same worker. Creating it per-test would add unnecessary filesystem overhead.
- **`testProject` is test-scoped**: Tests that create files via terminal commands, transcription output, or file operations mutate the project directory. Worker-scoped sharing would cause cross-test contamination. The cleanup cost for a temp dir is negligible (<10ms).
- **`testMultiWindow`**: The existing `fixtures.ts` export `testMultiWindow` is currently unused. It is preserved as-is in `fixtures/app.fixtures.ts` but not promoted to the composed `test` export. Tests needing multi-window can import it directly.
- **Two project-opening paths**: `appWithProject` (CLI `--project` arg) tests the startup path. `projectTreePage.openProject()` (IPC) tests the runtime open-project flow. Use `appWithProject` for tests that need a project from launch; use `openProject()` for tests that switch projects mid-test.
- **Fixture teardown handles quit dialogs**: `app.fixtures.ts` teardown calls `closeApp()` (which already handles dialog loops via its internal retry logic) instead of bare `electronApp.close()`. This prevents teardown failures when tests leave unsaved changes or active terminal sessions.

### Composed `test` export

```typescript
// fixtures/index.ts
import { base } from './app.fixtures'

export const test = base
  .extend<AppFixtures, WorkerFixtures>({ /* userDataDir, app, window */ })
  .extend<ProjectFixtures>({ /* testProject, appWithProject, windowWithProject, withSettings */ })
  .extend<PomFixtures>({ /* keyboardHelper, monacoPage, terminalPage, ... */ })
  .extend<EditorFixtures>({ /* withOpenFile */ })

export { expect } from '@playwright/test'
```

### Why this chain order matters

1. **App fixtures first** – `app` and `window` are prerequisites for everything else.
2. **Project fixtures second** – `testProject` creates the filesystem state that `appWithProject` needs.
3. **POM fixtures third** – POMs need `window` (from step 1) but not project state.
4. **Editor fixtures last** – `withOpenFile` depends on both project fixtures and POM fixtures (`projectTreePage` to navigate, `monacoPage` to verify).

No circular dependencies exist. Each layer only depends on layers above it.

### Fixture design sketches

#### `withSettings`

```typescript
// fixtures/project.fixtures.ts
withSettings: [async ({ testProject }, use, testInfo) => {
  // No-op if test doesn't request settings
}, { option: true }],

// Usage: test.use({ withSettings: { editor: { wordWrap: 'on' } } })
// Implementation:
//   1. Read existing .erfana/settings.json (or null if absent)
//   2. Create .erfana/ dir if missing (mkdirSync recursive)
//   3. Deep-merge partial settings onto defaults
//   4. Write merged settings.json
//   5. yield to test
//   6. Teardown: if original was null, delete file+dir; else restore original
```

#### `withOpenFile`

```typescript
// fixtures/editor.fixtures.ts
withOpenFile: [async ({ windowWithProject, projectTreePage, monacoPage }, use) => {
  // No-op if test doesn't request a file
}, { option: true }],

// Usage: test.use({ withOpenFile: 'test.md' }) or { withOpenFile: { path: 'test.md', mode: 'split' } }
// Implementation:
//   1. Navigate project tree to file (projectTreePage.clickFileByName)
//   2. If mode specified, switch view mode
//   3. Wait for Monaco readiness (monacoPage.waitForReady()) – skip if mode is 'preview'
//   4. yield monacoPage to test
```

Default mode is 'split'. If `mode: 'preview'`, skip Monaco readiness check (Monaco not mounted in preview-only mode).

## 4. Condition-based wait replacements

13 `waitForTimeout()` calls identified across the codebase. Each has a specific replacement strategy.

### 4.1 Terminal waits → `waitForPrompt()` (6 calls)

| # | Location | Current wait | Replacement | Rationale |
|---|----------|-------------|-------------|-----------|
| 1 | `helpers.ts` `terminal.open()` ~L523 | 1500ms PTY init | `waitForPrompt()` | Prompt appearance confirms PTY is ready |
| 2 | `helpers.ts` `terminal.open()` ~L537 | 500ms animation | Remove – `toBeVisible()` auto-retries | Playwright's auto-waiting handles CSS transitions |
| 3 | `helpers.ts` `terminal.open()` ~L545 | 1500ms PTY init | `waitForPrompt()` | Same as #1, different code path |
| 4 | `helpers.ts` `terminal.focus()` ~L562 | 100ms | `waitForFunction()` – check xterm textarea focused | `document.activeElement` matches xterm's hidden textarea |
| 5 | `helpers.ts` `terminal.restart()` ~L625 | 1000ms | `waitForPrompt()` | After restart, wait for new shell prompt |
| 6 | `helpers.ts` `terminal.waitForReady()` ~L641 | 1000ms | `waitForPrompt()` | Semantically identical to "terminal is ready" |

### 4.2 Test file waits → condition-based (6 calls)

| # | Location | Current wait | Replacement | Rationale |
|---|----------|-------------|-------------|-----------|
| 7 | test file ~L154 | 1500ms term init | Remove – `terminal.open()` includes `waitForPrompt()` | Redundant once POM handles wait internally |
| 8 | test file ~L162 | 1000ms cmd exec | `terminal.waitForOutput('E2E Terminal Test')` | Wait for specific expected output |
| 9 | test file ~L206 | 500ms preview load | `waitForTestId(TEST_IDS.EDITOR_PREVIEW)` | Preview panel has a test ID |
| 10 | test file ~L213 | 2000ms mermaid render | `previewPane.locator('.mermaid-container svg').waitFor()` | SVG presence confirms Mermaid rendered |
| 11 | test file ~L224 | 300ms toolbar transition | Remove – `hoverDiagram()` already includes `waitForTestId(MERMAID_TOOLBAR)` | Existing condition-based wait is sufficient |
| 12 | test file ~L242 | 1000ms direction re-render | `locator('.mermaid-container svg').waitFor()` after click | New SVG confirms re-render complete |

### 4.3 App lifecycle wait (1 call)

| # | Location | Current wait | Replacement | Rationale |
|---|----------|-------------|-------------|-----------|
| 13 | `helpers.ts` `closeApp()` ~L1093 | 300ms after dialog | `// KNOWN_WAIT: Inter-dialog pause during quit – page may be destroyed` | DOM queries unsafe during page teardown; NFR-002 exemption (setup-only path) |

Wait #13 is annotated rather than replaced because the page may be in the process of being destroyed during quit – Playwright DOM queries can throw when the page is closing. Future improvement: `page.waitForEvent('close', { timeout: 500 }).catch(() => {})`.

### 4.4 IPC roundtrip wait helper

FR-013 requires a general-purpose `waitForIpcComplete()`. Designed as a thin utility (not a POM method) because it's cross-cutting – used by terminal, editor, and project tree tests alike.

```typescript
// e2e/utils/wait-helpers.ts
export async function waitForIpcComplete(
  page: Page,
  options: {
    /** Locator or test ID that confirms the IPC result is visible */
    indicator: string | Locator
    /** Action that triggers the IPC call */
    trigger?: () => Promise<void>
    timeout?: number
  }
): Promise<void> {
  const { indicator, trigger, timeout = 10_000 } = options
  const locator = typeof indicator === 'string'
    ? page.getByTestId(indicator)
    : indicator

  if (trigger) {
    // Trigger and wait in parallel to avoid race
    await Promise.all([
      locator.waitFor({ state: 'visible', timeout }),
      trigger(),
    ])
  } else {
    await locator.waitFor({ state: 'visible', timeout })
  }
}
```

Usage examples:

```typescript
// Wait for file save (title bar updated):
await waitForIpcComplete(page, {
  indicator: page.locator('[data-testid="tab-title"]:not(:has-text("●"))'),
  trigger: () => keyboardHelper.save(),
})

// Wait for project open (tree populated):
await waitForIpcComplete(page, {
  indicator: TEST_IDS.PROJECT_TREE_ITEM,
  trigger: () => projectTreePage.openProject(path),
})
```

### 4.5 Additional `setTimeout` calls

Beyond the 13 `waitForTimeout()` calls above, the codebase contains `new Promise(resolve => setTimeout(...))` calls. These are all in teardown/cleanup paths (not assertion paths), satisfying NFR-002. They are documented as `KNOWN_WAIT` annotations during implementation.

| Location | Duration | Verdict |
|----------|----------|---------|
| `closeApp()` ~L1064 | 100ms | `KNOWN_WAIT`: electron-log flush before close |
| `closeApp()` ~L1109 | 100ms | `KNOWN_WAIT`: same pattern, alternate path |
| `fixtures.ts` ~L168 | 100ms | `KNOWN_WAIT`: app close teardown |
| `fixtures.ts` ~L201 | 100ms | `KNOWN_WAIT`: multi-window teardown |
| `fixtures.ts` ~L334 | 100ms | `KNOWN_WAIT`: helper close |
| `app-launch.e2e.ts` ~L38, L71 | 100ms | `KNOWN_WAIT`: post-close cleanup |

### Wait elimination summary

- **6 waits** → `waitForPrompt()` (new method in `TerminalPage`)
- **3 waits** → existing Playwright auto-waiting (`toBeVisible()`, `waitFor()`, `waitForTestId()`)
- **2 waits** → removed entirely (redundant with POM internal waits)
- **1 wait** → `waitForOutput()` (existing helper method)
- **1 wait** → `KNOWN_WAIT` annotation (page teardown unsafe for DOM queries)
- **6 additional `setTimeout`** → `KNOWN_WAIT` annotations (teardown paths, NFR-002 compliant)

## 5. Backward compatibility layer

During migration, `e2e/utils/helpers.ts` becomes a thin adapter that re-exports POM methods in the old namespace format. Existing test files continue to work without modification.

### Adapter pattern

```typescript
// e2e/utils/helpers.ts (after migration)
import { KeyboardHelper } from '../pages/keyboard.helper'
import { MonacoPage } from '../pages/monaco.page'
import { TerminalPage } from '../pages/terminal.page'
import { MermaidPage } from '../pages/mermaid.page'

// WeakMap caches – POM instances are reused per Page, GC'd when Page is closed
const keyboardCache = new WeakMap<Page, KeyboardHelper>()
const terminalCache = new WeakMap<Page, TerminalPage>()
const monacoCache = new WeakMap<Page, MonacoPage>()
const mermaidCache = new WeakMap<Page, MermaidPage>()

function getKeyboard(page: Page): KeyboardHelper {
  let kh = keyboardCache.get(page)
  if (!kh) { kh = new KeyboardHelper(page); keyboardCache.set(page, kh) }
  return kh
}

// Old API preserved:  keyboard.selectAll(page)
// New API:            keyboardHelper.selectAll()  (via fixture)

export const keyboard = {
  async selectAll(page: Page) { return getKeyboard(page).selectAll() },
  async copy(page: Page) { return getKeyboard(page).copy() },
  async paste(page: Page) { return getKeyboard(page).paste() },
  // ... all 11 methods
}

export const monaco = {
  async focus(page: Page) {
    const kb = getKeyboard(page)
    let mp = monacoCache.get(page)
    if (!mp) { mp = new MonacoPage(page, kb); monacoCache.set(page, mp) }
    return mp.focus()
  },
  // ... all 16 methods
}

export const terminal = {
  async open(page: Page) {
    let tp = terminalCache.get(page)
    if (!tp) { tp = new TerminalPage(page); terminalCache.set(page, tp) }
    return tp.open()
  },
  // ... all 12 methods
}

export const mermaid = {
  async hoverDiagram(page: Page) {
    let mp = mermaidCache.get(page)
    if (!mp) { mp = new MermaidPage(page); mermaidCache.set(page, mp) }
    return mp.hoverDiagram()
  },
  // ... all 12 methods
}

// Standalone functions remain unchanged
export { byTestId, waitForTestId, openProject, openProjectViaUI, closeApp } from './helpers.internal'
```

### Performance note

Adapter caches POM instances per `Page` via `WeakMap`, preserving `KeyboardHelper`'s modifier cache. Instances are GC'd when `Page` is closed. This avoids the overhead of creating new POM instances per call while maintaining correct cache behavior.

### Migration path for individual tests

```typescript
// Before (using helpers.ts adapter):
import { keyboard, monaco, terminal } from './utils/helpers'
test('example', async ({ page }) => {
  await terminal.open(page)
  await monaco.focus(page)
  await keyboard.selectAll(page)
})

// After (using fixtures):
import { test } from './fixtures'
test('example', async ({ terminalPage, monacoPage, keyboardHelper }) => {
  await terminalPage.open()
  await monacoPage.focus()
  await keyboardHelper.selectAll()
})
```

## 6. Vertical-slice migration sequence

Each slice is independently mergeable with all existing tests passing.

| Slice | Domain | Key deliverables | Waits eliminated |
|---|---|---|---|
| 1 | KeyboardHelper | `pages/keyboard.helper.ts`, barrel export, adapter with WeakMap cache | 0 |
| 2 | TerminalPage | `pages/terminal.page.ts`, `waitForPrompt()`, adapter update | #1–6 |
| 3 | MermaidPage | `pages/mermaid.page.ts`, SVG-based waits in adapter | #10–12 |
| 4a | ProjectTreePage | `pages/project-tree.page.ts`, adapter | 0 |
| 4b | Fixture infrastructure | `fixtures/app.fixtures.ts`, `fixtures/project.fixtures.ts`, `fixtures/index.ts` | 0 |
| 5 | MonacoPage + editor fixtures | `pages/monaco.page.ts`, `fixtures/editor.fixtures.ts`, `fixtures/pom.fixtures.ts` | #9 |
| 6a | Test file structure migration | 3 test files switch to `import { test } from './fixtures'` with fixture lifecycle (not `app-launch.e2e.ts`) | #7, #8 |
| 6b | POM fixture adoption + cleanup | Tests use destructured POM fixtures, `KNOWN_WAIT` annotations, `waitForIpcComplete` utility | #13 |

### Dependency ordering rationale

```
Slice 1: KeyboardHelper (no deps)
    ↓
Slice 2: TerminalPage (no POM deps, standalone)
Slice 3: MermaidPage (no POM deps, standalone)
    ↓ (2 and 3 can run in parallel)
Slice 4a: ProjectTreePage (needs stable POM pattern from 1–3)
Slice 4b: Fixture infrastructure (needs stable POM pattern from 1–3)
    ↓ (4a and 4b can run in parallel)
Slice 5: MonacoPage (depends on KeyboardHelper from slice 1, fixtures from slice 4b)
    ↓
Slice 6a: Test file structure migration (needs all POMs and fixtures)
Slice 6b: POM fixture adoption + cleanup (needs 6a complete)
```

### Excluded from fixture migration

`app-launch.e2e.ts` is intentionally excluded from fixture migration. It is a smoke test that verifies baseline Electron startup using minimal infrastructure. It remains on raw `@playwright/test` imports to serve as an independent canary – if fixture infrastructure breaks, app-launch tests still run.

### Slice acceptance criteria

Each slice must satisfy before merge:
1. All existing tests pass (no regressions)
2. New POM class has corresponding adapter in `helpers.ts`
3. Any eliminated `waitForTimeout()` calls are replaced with condition-based alternatives
4. TypeScript compiles cleanly (`npm run typecheck`)

## 7. Risk mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `waitForPrompt()` unreliable in CI | Medium | High | Configurable patterns + 10s fallback timeout; `// KNOWN_WAIT:` annotation if a specific wait proves flaky |
| `waitForPrompt()` false positive on output containing `$` or `%` | Medium | Medium | Tightened default regex requires `\w` prefix; tests can override with specific patterns |
| xterm DOM structure changes between versions | Low | High | `waitForPrompt()` uses `.xterm-rows` selector – tested against current xterm.js version; pin in package.json |
| Fixture composition too deep (slow test startup) | Low | Medium | Worker-scoped `userDataDir` amortizes setup; test-scoped `testProject` is cheap (<10ms copy); monitor with `--reporter=list` timings |
| Backward-compat adapter masks bugs | Medium | Low | Adapter uses WeakMap caching (preserves POM state); each slice PR should migrate at least one test to fixtures as proof |

## 8. Workstream coverage matrix

Verifying all 3 spec workstreams are addressed:

| Workstream | Spec requirements | Architecture sections |
|---|---|---|
| WS1: POM migration | FR-001 through FR-005 | Sections 2 (class hierarchy), 5 (backward compat), 6 (slices 1–3, 5) |
| WS2: Fixture promotion | FR-006 through FR-009 | Sections 1 (file org), 3 (fixture graph + design sketches), 6 (slice 4a/4b) |
| WS3: Condition-based waits | FR-010 through FR-013 | Sections 4 (all 13 replacements + 6 setTimeout audits), 4.4 (`waitForIpcComplete`), 6 (waits per slice) |

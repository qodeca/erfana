# E2E Testing with Playwright

## Overview

Erfana supports automated E2E testing using Playwright with Electron. This guide covers setup, configuration, and test patterns.

**Related documentation**:
- [E2E Selectors](./e2e-selectors.md) – Complete testid catalog (259 testids)
- [E2E Third-Party](./e2e-third-party.md) – Monaco, xterm.js, Mermaid testing
- [E2E Helpers](./e2e-helpers.md) – Test utilities and patterns (backward-compatible adapter)
- [E2E Debugging](./e2e-debugging.md) – Debugging and CI/CD
- [E2E Troubleshooting](./e2e-troubleshooting.md) – Common issues and fixes
- [E2E Lessons Learned](./e2e-lessons-learned.md) – Hard-won insights
- Spec #011 (archived) – Specification
- Spec #018 (archived) – E2E infrastructure overhaul (POM pattern, fixtures, condition-based waits)
- [Test ID constants](../../src/renderer/src/constants/testids.ts) – Source code
- [POM classes](../../e2e/pages/) – Page Object Model implementations
- [Fixtures](../../e2e/fixtures/index.ts) – Composed Playwright fixtures (POM, project, settings, open-file)
- [Wait helpers](../../e2e/utils/wait-helpers.ts) – Race-safe IPC wait utilities

---

## Prerequisites

- Node.js 24+
- Playwright installed: `npm install --save-dev @playwright/test`

---

## Quick start

### Running tests

```bash
# Functional E2E tests
npm run test:e2e

# Run with visible window
npm run test:e2e:headed

# Visual regression tests
npm run test:e2e:visual

# Update visual baselines
npm run test:e2e:update-screenshots
```

### Test build vs production build

Erfana uses Electron fuses for security hardening. For E2E testing with debugging:

```bash
# Production build (inspector disabled - secure)
npm run build:mac

# Test build (inspector enabled - for Playwright debugging)
ERFANA_TEST_BUILD=true npm run build:mac
```

> **Security note**: Test builds have reduced security (inspector enabled). Only use for testing, never distribute.

| Build Type | `--inspect` Flag | Use Case |
|------------|------------------|----------|
| Production | Disabled (fuse) | Distribution to users |
| Test | Enabled | Playwright debugging, E2E tests |

---

## Playwright configuration

Create `playwright.config.ts` in the project root:

Three Playwright projects are configured:

| Project | Test match | Retries | Purpose |
|---------|-----------|---------|---------|
| `electron` | `**/*.e2e.ts` (ignores `visual-regression*` and `audio-transcription*`) | 2 on CI, 0 locally | Functional E2E tests |
| `transcription` | `**/audio-transcription*.e2e.ts` | 2 on CI, 0 locally | Env-gated: runs only with `ERFANA_E2E_TRANSCRIPTION=1` (real, paid OpenAI calls) |
| `visual` | `**/visual-regression.e2e.ts` | 0 | Screenshot comparison (diffs must be investigated) |

Visual project settings: `snapshotDir: './e2e/screenshots'`, `snapshotPathTemplate: '{snapshotDir}/{arg}-{platform}{ext}'`, `maxDiffPixelRatio: 0.01`, `animations: 'disabled'`.

Page-level captures (welcome, editor, terminal) pass `clip: PAGE_CLIP` — the `1280x800` rectangle the visual fixture asks the window for — so the baseline
records the app's own layout rather than whatever content size the host window manager granted. Element-level captures (settings overlay, confirm dialog,
image-viewer toolbar) need no clip: the element bounds are the capture.

Baselines are per platform and committed. Both the **darwin** and the **win32** set exist for all six states; the three page-level captures were
regenerated in both sets on 2026-09-04, after the clip above was introduced. **A capture-geometry change invalidates every platform's baselines, not just
the host you are sitting at** — the clip landed with only the win32 set regenerated, and the three darwin baselines then failed on dimensions alone
(`Expected an image 1400px by 868px, received 1280px by 800px`) until they were regenerated on a macOS host. Only that host can regenerate its own set, so
a clip change is finished when every platform has been visited. The two element-level baselines were not regenerated and still carry each host's own window
size. A missing baseline is not skipped — `assertBaselineExists` throws, and `playwright.config.ts` sets
`updateSnapshots: 'none'`, so the auto-write-on-first-run path stays closed. Generate a new platform's set with
`npm run test:e2e:update-screenshots` and commit it.

See `playwright.config.ts` for the full configuration.

---

## Page Object Model (POM) architecture

Erfana E2E tests use a Page Object Model pattern with composed Playwright fixtures.

### POM classes

Located in `e2e/pages/`:

| Class | Purpose |
|-------|---------|
| `KeyboardHelper` | Platform-aware keyboard shortcuts (Cmd/Ctrl abstraction) |
| `TerminalPage` | Terminal interactions – `waitForPrompt()`, `sendCommand()`, `waitForOutput()` |
| `MonacoPage` | Editor interactions – `waitForReady()`, `focus()`, `setContent()`, `getContent()` |
| `MermaidPage` | Mermaid diagram interactions |
| `ProjectTreePage` | Project tree navigation and file operations |
| `ImageViewerPage` | Image viewer tab (#70, extended for #73) – `openFromTree()`, `waitForReady()`, `marker()` / `waitForMarker()`, `zoomIn()`, `transformStyle()`, `expectStatusState()`, `expectBanner()` / `expectNoBanner()`, `clickReload()`, `enterFullScreen()` / `exitFullScreen()`. Export (#73): three panel-scoped locators `exportPngButton()` / `exportPdfButton()` / `copyButton()`, their overlay-scoped twins `fullScreenExportPngButton()` / `fullScreenExportPdfButton()` / `fullScreenCopyButton()`, the `exportStatus()` polite live region (the assertive `image-viewer-export-alert` region has no POM locator — query it directly), plus `clickExport()`, `expectExportBusy()` and `expectExportAnnouncement()` |
| `ImageViewerNarrowPage` | Extends the above for the narrow-width toolbar contract (#73) – `toolbar()`, `controls()`, `constrainPanelWidth()`, `toolbarScrollMetrics()`, `panelScrollLeft()`, `focusedTestId()`, `expectWithinPanel()`. A separate file only because the base POM is near the 500-line cap |
| `HtmlPreviewPage` | HTML preview (#111) – takes `(page, app)` because the previewed page runs in a sealed `WebContentsView` and is read main-side: `open()` (path-exact, waits for the `erfana-preview://` web contents), `snapshot()` / `eval()` / `livePreviews()` / `waitForTitled()` (address one of several with `HtmlPreviewPage.target(relPath)`), `clickInPreview()` (untrusted, `will-navigate` path) vs `clickTrusted()` (real input event – the only way to a gesture-gated path such as an external link), `viewBounds()`; DOM chrome: `placeholder()` / `panel()` / `stillFrame()` / `tab()` scoped by basename, the failure badge, and the permission band (`chip()`, `openBand()`, `hostRow()`, `allowButton(origin)`, `confirmDialog()` / `confirmButton()` / `cancelButton()`, `allowedSection()`). Not a composed fixture – construct it in the test. Companions: `e2e/fixtures/localServer.ts` (ephemeral loopback server + `localServer` fixture) and `e2e/fixtures/logTail.ts` (condition-based read of what `~/.erfana/logs/main.log` gains after a mark) |

> `ImageViewerPage` is **not** exposed as a composed fixture – the specs that use it construct it directly (the export specs go through `openImage()` in `e2e/utils/image-export-helpers.ts`, which is the same thing plus the export budget), because one of them needs its own launch environment. Three conventions in it are worth copying. Panel locators are scoped **inside** `[data-testid="image-viewer-panel"]`, so the full-screen portal (which renders the same test ids into `#portal-root`) can never satisfy a panel assertion — the deliberate exceptions are the `fullScreen*` locators, which scope to the overlay instead, and `exportStatus()`, which is looked up on the page because the panel-owned live region is rendered into whichever surface is on top and must resolve to exactly one element either way. Freshness is asserted on the **decoded** bytes via a `data-marker` attribute embedded in the SVG, not by diffing two multi-kilobyte data URLs — a failing assertion then names which version is on screen instead of dumping base64. And busy is `aria-disabled`, never `disabled`, so `clickExport()` arms a `MutationObserver` before the click rather than polling: a stubbed save dialog can settle inside one poll interval, so the busy transition has to be recorded, not sampled.

### Composed fixtures

Import `test` from `e2e/fixtures/index.ts` to get POM instances as fixtures:

```typescript
import { test, expect } from '../fixtures'

test('terminal sends command', async ({ terminalPage }) => {
  await terminalPage.waitForPrompt()
  await terminalPage.sendCommand('echo hello')
  await terminalPage.waitForOutput('hello')
})
```

Available fixtures:

| Fixture | Scope | Description |
|---------|-------|-------------|
| `userDataDir` | Worker | Isolated Electron user data directory |
| `extraLaunchArgs` | Test (option) | Extra Chromium/Electron switches appended to the launch args of `app`, `appWithProject` and `appWithTestProject`; default `[]` |
| `resetRendererStorage` | Test (option) | Deletes the renderer's persisted `localStorage` / `sessionStorage` before launch; default `false`. Opt in only from a spec whose subject *is* persisted renderer state |
| `app` | Test | Electron application instance |
| `window` | Test | First window page |
| `keyboardHelper` | Test | Platform-aware keyboard shortcuts |
| `terminalPage` | Test | Terminal POM instance |
| `monacoPage` | Test | Monaco editor POM instance |
| `mermaidPage` | Test | Mermaid diagram POM instance |
| `projectTreePage` | Test | Project tree POM instance |

### Project and setup fixtures

Additional fixtures for tests that need a project directory, settings, or an open file:

| Fixture | Scope | Description |
|---------|-------|-------------|
| `appWithProject` | Test | Launches Electron with the repo's default test project (`DEFAULT_TEST_PROJECT`) already loaded |
| `windowWithProject` | Test | First window page from `appWithProject`, waited for the project tree |
| `testProject` | Test | Creates an isolated temp directory with configurable seed files; auto-cleanup on teardown |
| `withSettings` | Test | Writes `.erfana/settings.json` into the project (no teardown – testProject owns cleanup) |
| `withOpenFile` | Test | Opens a file in the editor, waits for Monaco readiness, provides a `MonacoPage` |
| `appWithTestProject` | Test | Launches Electron with the `testProject` path as argument |
| `windowWithTestProject` | Test | First window page from `appWithTestProject` |
| `localServer` | Test | Ephemeral loopback HTTP server (`http://127.0.0.1:<port>`) serving a probe script and recording every request; closed on teardown. Composed in `e2e/fixtures/localServer.ts`, not in `fixtures/index.ts` — import `test` from there to use it |

Configure via option fixtures with `test.use()`:

```typescript
import { test, expect } from '../fixtures'

test.use({
  testProjectFiles: { 'notes.md': '# Notes\n\nSeed content.' },
  openFilePath: 'notes.md'
})

test('editor opens seed file', async ({ withOpenFile }) => {
  const content = await withOpenFile!.getContent()
  expect(content).toContain('Seed content')
})
```

### Wait helpers

Located in `e2e/utils/wait-helpers.ts`:

| Helper | Purpose |
|--------|---------|
| `waitForIpcComplete` | Race-safe IPC wait – uses `Promise.all` to observe a UI state change triggered by an async operation |

```typescript
import { waitForIpcComplete } from '../utils/wait-helpers'

await waitForIpcComplete({
  locator: byTestId(page, 'title-bar'),
  expectedState: 'visible',
  trigger: () => keyboard.save()
})
```

### Backward compatibility

The `e2e/utils/helpers.ts` adapter provides backward compatibility – existing tests using namespace helpers (e.g., `monaco.focus(page)`) continue to work. The adapter uses WeakMap-based caching to delegate calls to POM instances internally.

### Fixture dependency graph

```
Worker: userDataDir
Test:   app → window → POM fixtures (keyboardHelper, terminalPage, monacoPage, ...)
        appWithProject → windowWithProject
        testProject → appWithTestProject → windowWithTestProject
                    → withSettings (side effect)
                                           → withOpenFile (provides MonacoPage)
```

### Fixture selection guide

| Scenario | Fixtures to use |
|----------|----------------|
| Basic app launch, no project | `app`, `window`, POM fixtures |
| Existing project directory | `appWithProject`, `windowWithProject` |
| Isolated temp project (default seed) | `testProject`, `appWithTestProject`, `windowWithTestProject` |
| Custom seed files | `test.use({ testProjectFiles: { ... } })` + above |
| Project settings | `test.use({ projectSettings: { ... } })` + `withSettings` |
| Open a file in editor | `test.use({ openFilePath: 'file.md' })` + `withOpenFile` |

> **Note**: `withOpenFile` uses `clickFileByName` (basename match). This works for flat projects with unique filenames. For nested projects with duplicate basenames, instantiate `ProjectTreePage` and use `clickFileInTree()` directly.

### Condition-based waits

Prefer condition-based waits over `waitForTimeout`:

| Instead of | Use |
|------------|-----|
| `waitForTimeout(1000)` after terminal init | `terminalPage.waitForPrompt()` |
| `waitForTimeout(500)` after command | `terminalPage.waitForOutput(expected)` |
| `waitForTimeout(N)` for element | Playwright auto-waiting (`toBeVisible()`, `toBeAttached()`) |

When a timeout is truly necessary (e.g., animation settling), annotate it with `// KNOWN_WAIT: <reason>`.

### Shared locator utilities

Located in `e2e/utils/locators.ts`:

```typescript
import { byTestId, byDynamicTestId, waitForTestId, waitForTestIdHidden } from '../utils/locators'

// Static testid
const btn = byTestId(page, 'activity-bar-btn-files')

// Dynamic testid (with path hash)
const node = byDynamicTestId(page, 'project-tree-node', filePath)

// Wait for visibility
await waitForTestId(page, 'terminal-instance')
await waitForTestIdHidden(page, 'dialog-overlay')
```

---

## Test structure

### Basic test template

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test.describe('Erfana E2E', () => {
  test('should launch app and show activity bar', async () => {
    // Launch Electron app
    const app = await electron.launch({
      args: [path.join(__dirname, '..')],
    })

    // Get the first window
    const window = await app.firstWindow()

    // Wait for app to be ready
    await window.waitForLoadState('domcontentloaded')

    // Test: Activity bar should be visible
    const activityBar = window.locator('[data-testid="activity-bar"]')
    await expect(activityBar).toBeVisible()

    // Cleanup
    await app.close()
  })
})
```

### Test with project loaded

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test('should open project and display files', async () => {
  const app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      // Pass project path as argument
      '/path/to/test/project',
    ],
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Wait for project tree to populate
  const projectTree = window.locator('[data-testid="project-tree"]')
  await expect(projectTree).toBeVisible()

  // Verify files are shown (not empty state)
  const emptyState = window.locator('[data-testid="project-tree-empty"]')
  await expect(emptyState).not.toBeVisible()

  await app.close()
})
```

### Test fixture pattern

For reusable app setup, create a fixture:

```typescript
// e2e/fixtures/index.ts
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

type TestFixtures = {
  app: ElectronApplication
  window: Page
}

export const test = base.extend<TestFixtures>({
  app: async ({}, use) => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..')],
    })
    await use(app)
    await app.close()
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect } from '@playwright/test'
```

Usage:

```typescript
// e2e/activity-bar.e2e.ts
import { test, expect } from './fixtures'

test('activity bar buttons work', async ({ window }) => {
  // Click files button
  await window.locator('[data-testid="activity-bar-btn-files"]').click()

  // Verify project tree is visible
  const projectTree = window.locator('[data-testid="project-tree"]')
  await expect(projectTree).toBeVisible()
})
```

---

## Environment setup

### API key configuration

Some E2E tests require external API credentials:

1. Create `.env` file in project root with your API keys:
   ```bash
   OPENAI_API_KEY=your-key-here
   ```

2. See `.env.example` for all available environment variables

3. Tests requiring API keys will skip gracefully if the variable is not set

### Erfana-specific environment variables

Three `ERFANA_E2E_*` variables change app behaviour for tests. They are read by the app, not by Playwright, so they belong in the environment of the launched Electron process (`ERFANA_E2E_FORCE_CRASH`, `ERFANA_E2E_FAST_SHELL`) or of the Playwright run itself (`ERFANA_E2E_TRANSCRIPTION`, a project gate):

| Variable | Effect |
|----------|--------|
| `ERFANA_E2E_FORCE_CRASH=1` | Launcher-only crash injection for `root-error-boundary.e2e.ts`: main appends `--erfana-force-crash` to `webPreferences.additionalArguments`, the preload re-exposes it as `window.__ERFANA_FORCE_CRASH__`, and `ForcedCrash` in `App.tsx` throws during render. Gated on `!app.isPackaged`, so packaged builds ignore it; the renderer can never set it |
| `ERFANA_E2E_FAST_SHELL=1` | POSIX only: the PTY bootstrap execs `/bin/sh -i` instead of `exec -l "$SHELL" -i`, skipping user rc files so terminal specs start in tens of milliseconds rather than seconds |
| `ERFANA_E2E_TRANSCRIPTION=1` | Enables the `transcription` Playwright project (real, paid OpenAI calls; also needs `OPENAI_API_KEY`). Without it the project matches nothing and the `capability-summary` reporter prints a `SKIPPED CAPABILITIES` line |

`ERFANA_TEST_BUILD=true` is a *build*-time variable, not a test-time one – see [Test build vs production build](#test-build-vs-production-build) above. Canonical table: [Testing overview § E2E environment variables](./README.md#e2eui-playwright-electron).

### Test files

All 30 specs in `e2e/`:

- `app-launch.e2e.ts` – Application launch, activity bar, welcome panel visibility
- `third-party-components.e2e.ts` – Monaco editor, xterm.js terminal, Mermaid diagrams
- `directory-watcher.e2e.ts` – Directory watcher pipeline verification
- `audio-transcription.e2e.ts` – Full audio import transcription lifecycle (real OpenAI API; `transcription` project, gated by `ERFANA_E2E_TRANSCRIPTION=1` + `OPENAI_API_KEY`)
- `context-menu-explain.e2e.ts` – Context-menu Explain prompt flow end-to-end in both preview and editor contexts (right-click → Explain → terminal opens)
- `document-import.e2e.ts` – Full LiteParse document-import UI lifecycle: file dialog stub → DocumentImportDialog options → conversion → result on disk
- `welcome-open-toolbar-import.e2e.ts` – Welcome-screen Open/Change Project button (label toggle, real `file:openProject` IPC with the native dialog stubbed) plus the Project Tree toolbar Import button
- `fixture-smoke.e2e.ts` – Smoke tests for the composed Playwright fixtures (`testProject`, `withSettings`, `appWithTestProject`, `windowWithTestProject`, `withOpenFile`)
- `settings-logs.e2e.ts` – Settings overlay "Logs folder" section: path display and the "Open" reveal button
- `git-status.e2e.ts` – Project Tree git decorations: file letter-badges, folder dots, priority bubbling (wiring smoke; the cross-platform separator guard is the `gitStatus.logic.test.ts` unit suite)
- `git-status-on-edit.e2e.ts` – Badge refresh after an in-editor autosave with no manual refresh (keystroke → autosave → chokidar `change` → IPC → store → repaint)
- `terminal-expand.e2e.ts` – Terminal maximize over the editor area (Cmd/Ctrl+Shift+M and header button); covers the AppDockLayout splitview manipulation that has no unit test (dockview is not mocked)
- `terminal-resize.e2e.ts` – Regression guard for the editor/terminal sash drag — simulates a real mouse drag and asserts the editor area actually shrinks (would fail on v0.10.0 unfixed; see [CHANGELOG § 0.10.1](../CHANGELOG.md#0101))
- `dockview-resize.e2e.ts` – Regression guard that dockview drag-to-resize still works after the #211 CSS audit (AC #7)
- `user-select.e2e.ts` – Organic selection coverage for #211 on two surfaces (markdown preview, settings overlay); cross-cutting policy coverage lives in `userSelect.audit.test.ts`
- `camera-mirror.e2e.ts` – Camera preview mirroring default + per-camera toggle, 16:9 `object-fit: contain` framing, native Enter-to-capture (#42), against Chromium's fake capture device
- `root-error-boundary.e2e.ts` – #60: a launcher-injected renderer crash must show the recovery screen (details toggle, Copy / Open logs / Restart), not a blank window, plus a negative case for the flag being unset
- `preview-refresh.e2e.ts` – #70: an open image tab repaints after an in-place rewrite **and** after an atomic replace (`> tmp && mv tmp target`), the "Reloaded from disk" status appears and self-clears, zoom survives a same-size rewrite and resets to fit when the size changes, a delete shows the banner while keeping the last image (with **Reload** recovering), and a `MutationObserver` proves the `<img>` is never unmounted and `src` never blanks. Freshness is asserted on the decoded `data-marker`, not on the `src` attribute alone
- `preview-refresh-terminal.e2e.ts` – #70: clicking an image path in a terminal opens the image viewer, not Monaco. Split out because it needs its own launch environment (`ERFANA_E2E_FAST_SHELL`) and because clicking an xterm link is a geometry problem — the WebGL renderer paints to canvas, so the cell grid is reconstructed from xterm's IME helper textarea and the click is retried across the printed rows (the link provider validates the path over IPC, so the first click can land before the link exists)
- `image-export.e2e.ts` – #73: the BYTES half of PNG / PDF / clipboard export from the image viewer. The only automated coverage of real pixel output —
  all eight extensions exported to PNG, an SVG rasterized at 2x its viewBox, an animated GIF's first frame (asserted on the exported pixel, not just the
  toast), a multi-size ICO's largest entry, single-page PDF geometry checked with the runtime gate's own `verifyPdfGeometry` and tolerance, and alpha
  preserved on PNG but flattened to white on the clipboard. Fixtures are generated at test time from `e2e/fixtures/images/generateImageFixtures.ts` (no
  binary file is committed); the native save dialog is stubbed with `stubDialog`, and the clipboard is read back through the main process, never
  `navigator.clipboard`
- `image-export.behaviour.e2e.ts` – #73: the BEHAVIOUR half of the same feature, split off so both files stay under the 500-line cap. An export is a
  conversion of the file and not a screenshot of the panel (zoom changes nothing; a rewrite between two exports changes everything), all three actions
  run from the full-screen overlay with the settled sentence going to the in-overlay live region rather than a toast the `aria-modal` overlay would
  hide, and a cancelled save dialog writes nothing and says nothing. Shares the helpers and the fixture generator with the spec above; each file
  composes its own `exportDir`, so the two can run in parallel
- `image-export.matrix.e2e.ts` – #73: the PDF and clipboard columns of acceptance criterion 1's 3 x 8 grid, pinned per format from the PANEL toolbar (the
  PNG column lives in `image-export.e2e.ts`). Rows are derived from `FORMAT_ROWS` in `e2e/utils/image-export-helpers.ts`, so a ninth supported format
  cannot be added to the fixture table and silently skipped, and the row list itself is asserted. Each clipboard row clears the board main-side first, so
  `empty: false` is evidence this export wrote something (two fixtures deliberately share a pixel size). Also carries the `PDF page-size grid regression`
  case — see the note below
- `image-export.overlay-matrix.e2e.ts` – #73: the same 3 x 8 grid run from the FULL-SCREEN OVERLAY, which AC 1 names as a first-class surface. Asserts
  through overlay-scoped locators and reads the in-overlay live region rather than a toast the `aria-modal` overlay would hide, including the per-format
  qualifier (GIF frame, ICO size, SVG 2x)
- `image-viewer-narrow.e2e.ts` – #73: the toolbar's narrow-width contract measured in a real Chromium layout, which
  `ImageViewerPanel.toolbarOverflow.test.ts` can only pin as stylesheet text. All eight controls stay hit-testable at a 300 px panel, and Tab scrolls the
  rightmost control into view by scrolling the TOOLBAR — asserting the panel container's `scrollLeft` stays 0 is what distinguishes the fix from the old
  behaviour, where Chromium scrolled the hidden `.container` instead and the rest of the row left the screen
- `html-preview-corpus.e2e.ts` – #74: seeds each fixture under `e2e/fixtures/html-preview-corpus/` into an isolated project and asserts its machine sentinel
  against the REAL native `WebContentsView`, read main-side via `app.evaluate`, not a DOM stand-in. Covers script execution, a runaway loop that must not
  freeze the host, multi-file relative CSS / JS / image resolution, a page that renders while its load diagnostics are badged, an unapproved remote
  subresource being blocked (and then approved from the permission band), and the view being sized on open with no tab switch to prod it
- `html-preview-links.e2e.ts` – sd-074b: link routing inside a previewed page, plus two previews running at once. Synthesised clicks (`clickInPreview`) are
  untrusted, so they drive the `will-navigate` fallback — plain link, `javascript:` link, a path escaping the project, a same-page anchor. The external-link
  case needs `clickTrusted` (a real `webContents.sendInputEvent` gesture, the only thing that may reach the OS browser) and asserts the consent dialog's
  Cancel is logged as the outcome
- `html-preview-perf.e2e.ts` – sd-074b AC24: the save-to-visible-change budget. The clock starts at the `fs.writeFile` that changes a stylesheet and stops
  when the running page's computed background reflects it — 20 samples, P95 under 300 ms, measured with one preview open and again with the live-view budget
  saturated. Local gate only (shared CI runners flake on perf floors)
- `html-preview-approval.e2e.ts` – #111: the whole approval chain end to end against a real server on an ephemeral loopback port. In order: nothing reaches
  the socket before approval, the permission band names the whole origin, Allow → Confirm makes the blocked script actually run inside the page, the server
  records the request, and the grant lands in the project file under `origins`. Uses the `localServer` fixture
- `html-preview-eviction.e2e.ts` – sd-074b D5: the `PREVIEW.MAX_LIVE_VIEWS` live-view budget. Opening one preview more than the budget tears the least
  recently active one down to its still frame and marks it `suspended`; clicking that tab wakes it again. Both halves are asserted against the real
  `erfana-preview://` web contents, because the wake half was seen not to happen on Windows
- `visual-regression.e2e.ts` – Visual regression for 6 UI states (welcome, editor, terminal, settings, confirm dialog, image viewer toolbar in a narrow
  panel). State (f) uses its own extended test object so the image fixtures it seeds do not change the project tree in states (a)–(e)

> **Why the PDF geometry tolerance is one CSS pixel (#73).** Chromium's `printToPDF` quantizes a CSS `@page` size onto a 1/300 in grid, and for any
> dimension where `px % 8 === 6` the produced MediaBox comes back **0.54 pt larger** than requested. The gate's tolerance was originally 0.5 pt — tighter
> than Chromium's own output grid can express — so it refused roughly one pixel size in eight per axis, in every format, and the user got "the PDF page came
> out the wrong size, so nothing was written" for an ordinary image. `IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT` is now **0.75 pt**, exactly one CSS pixel at
> 96 dpi: still far too tight to admit letterboxing, scaling or multi-page output, all of which are off by whole page fractions. The `.jpg`, `.jpeg`
> (22 px tall) and `.bmp` (14 px tall) matrix rows sit on that grid and pass like any other row, on both surfaces; the `image export – PDF page-size grid
> regression` case holds the line with a **PNG** at 60 x 22, so a re-tightened tolerance fails there first.

> **Why `root-error-boundary.e2e.ts` bypasses the composed fixtures**: it needs a per-launch environment (`ERFANA_E2E_FORCE_CRASH` set for the positive case, and explicitly *deleted* from `process.env` for the negative one, so a developer's shell cannot make the negative test pass for the wrong reason). The shared `app` fixture owns its own launch and takes no env, so the spec calls `electron.launch()` directly and pairs it with `createTempUserDataDir()` from `e2e/utils/helpers.ts` to keep the per-test user-data isolation the `userDataDir` fixture would otherwise provide. Use the fixtures unless a spec genuinely needs a custom launch environment.

---

## Key concepts

### Testid naming convention

Pattern: `{component}-{element}-{identifier?}` with `-btn-` for buttons

```typescript
// Static testids
'activity-bar'           // Container
'activity-bar-btn-files' // Button within activity bar

// Dynamic testids (with path hash)
'project-tree-node-a1b2c3d4'  // Tree node for specific file
'tab-item-f3e2d1c0'           // Tab for specific file
```

### Third-party components

Monaco, xterm.js, and Mermaid have internal DOM that can't have testids. Use wrapper elements and keyboard input. See [E2E Third-Party](./e2e-third-party.md).

### Portal elements

Dialogs, context menus, and toasts render in React portals. Query them globally, not as children of other elements. See [E2E Helpers](./e2e-helpers.md).

### Dialog handling

The `closeApp()` helper handles quit confirmation dialogs properly by:
1. Triggering quit via `window.close()` (exercises real quit flow)
2. Using retry loop for race conditions
3. Wrapping operations in try-catch (page invalidation is expected)

See [E2E Helpers](./e2e-helpers.md) for implementation.

---

## References

- [Playwright Electron documentation](https://playwright.dev/docs/api/class-electron)
- [Playwright locators](https://playwright.dev/docs/locators)
- Spec #011 (archived)
- [Test ID constants](../../src/renderer/src/constants/testids.ts)
- [Erfana security documentation](../security.md)

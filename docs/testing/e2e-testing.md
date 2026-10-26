# E2E Testing with Playwright

## Overview

Erfana supports automated E2E testing using Playwright with Electron. This guide covers setup, configuration, and test patterns.

**Related documentation**:
- [E2E Selectors](./e2e-selectors.md) – Complete testid catalog (274 testids)
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
- [Bounded exec](../../e2e/utils/bounded-exec.ts) – The only way an e2e helper may call `executeJavaScript` (a deadline that names the call)

---

## Prerequisites

- Node.js 24+
- Playwright: already a devDependency (`@playwright/test`), installed by `npm ci`

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

### Headless on Linux in Docker

The `electron` project also runs on Linux under xvfb (a virtual X screen), inside Docker, so a run needs no visible window and does not take over the Mac. Docker Desktop must be running.

```bash
# Whole functional suite (--project=electron is added when you pass no --project)
npm run test:e2e:linux

# Any Playwright arguments pass through
npm run test:e2e:linux -- e2e/editor-save.e2e.ts -g "Autosave"
```

What `scripts/e2e-linux.sh` does:

1. Builds the image from `e2e/docker/Dockerfile` for the host's native architecture (arm64 on Apple Silicon, amd64 elsewhere): Node 24, the Electron runtime libraries, xvfb plus the openbox window manager, real `bash` and `zsh`, `git`, Python 3.12 and a C++ toolchain for node-pty.
2. Mounts the repo read-write at `/work`, running as your own user id (HOME is `/tmp/home`). `node_modules`, `out/` and the npm download cache live in **named Docker volumes** (`erfana-e2e-node-modules-<hash>`, `erfana-e2e-out-<hash>`, `erfana-e2e-npm-cache-<hash>`), so the macOS copies on the host are never touched. The image tag carries the same hash.
3. Runs `npm ci` (never `npm install`), runs `npx electron-vite build`, then `xvfb-run -a … npx playwright test <args>` (`e2e/docker/run-suite.sh`). The script compares the hash of `package-lock.json` before and after and fails if it changed; the suite's own exit code wins when both fail.
4. Writes the HTML report and the test results straight to `.local/e2e-linux/` (git-ignored, emptied at the start of every run); the repo-root `playwright-report/` and `test-results/` are not used.

The first run takes a few minutes longer (image build, `npm ci`, native rebuild); later runs reuse the volumes. A full run takes about 8 minutes on an Apple Silicon Mac.

`--no-sandbox` is not needed: Playwright's `electron.launch` adds it itself unless `chromiumSandbox: true` is passed, and nothing in the app code or the fixtures changes for the container. The one environment change the fixtures needed is `XAUTHORITY` in the env allowlist (`e2e/fixtures/isolation.ts`): `xvfb-run` protects its display with an auth file, and without the variable the app cannot open the display.

The script sets `ERFANA_E2E_LINUX_CONTAINER=1`. Tests read it only through `IS_LINUX_CONTAINER` (`e2e/utils/linux-container.ts`); no app code does.

**Not run in the container**

- The `visual` project: its baselines are `-darwin` PNGs (see `snapshotPathTemplate`), and there are no Linux baselines.
- The `transcription` project: needs `ERFANA_E2E_TRANSCRIPTION=1` and an API key, as everywhere.

**Skipped or adapted in the container**

| Test | What happens | Why |
|------|--------------|-----|
| `html-preview-drag-freeze.e2e.ts` › "should keep the page hidden for the rest of the drag…" | skipped (#299) | Under xvfb the page reports drawn again after every move once the freeze engaged (8 of 8 steps). Possible Linux app bug, not confirmed on a real desktop. |
| `html-preview-drag-freeze.e2e.ts` › "should leave the terminal / project tree sash at the pointer…" (2 tests) | skipped (#299) | Same finding: the page is not reliably hidden during a sash drag under xvfb (failed in the last run, passed in earlier ones). |
| `context-menu-explain.e2e.ts` › "Editor: right-click shows menu with disabled Explain…" | skipped (#299) | Explain is already enabled at the first right-click under xvfb, so a selection exists. Cause not isolated. |
| `html-preview-drag-freeze.e2e.ts` › "should show the page on its settled area when a fast drag ends…" | skipped on every non-macOS host | Existing skip, unrelated to the container. |

One test helper was changed for the container, safely for macOS and Windows too:

- `MonacoPage.focus()` and `waitForCursor()` no longer wait for the cursor to be *visible* (it blinks, so a 2 s poll can see only hidden phases); `focus()` waits for Monaco's `focused` class, clicking again until it takes, after waiting for the editor to be laid out.

`TerminalPage.waitForPrompt()` used to press Enter once on a still-blank screen in the container. That workaround was removed once the app kept its first prompt (#302, below); the wait now reads the screen until a prompt is drawn and stable, for up to `PROMPT_TIMEOUT_MS` (30 s), and a timeout reports the last screen it read (#288).

**Findings about the app on Linux** (tracked in #299)

- **Blank terminal after start – fixed in #302.** `TerminalService` used to drop all pty output while `isClearing` was set (the clear handshake), so a quick shell's first prompt could vanish and the terminal stayed blank until the first keystroke (2 to 6 terminal-opening tests per container run). Output that arrives during the handshake is now kept.
- **Splitter drag freeze.** See the first row of the table above.

**Environment notes**

- `/bin/sh` is linked to bash in the image. `ERFANA_E2E_FAST_SHELL` tests exec `/bin/sh -i`, which is bash on macOS; Ubuntu's dash made the blank-terminal race above more likely.
- Without a window manager Monaco-heavy specs lose focus and window maximize does nothing, so `e2e/docker/run-under-xvfb.sh` starts openbox before Playwright.

---

## Playwright configuration

Create `playwright.config.ts` in the project root:

Four Playwright projects are configured:

| Project | Test match | Retries | Purpose |
|---------|-----------|---------|---------|
| `electron` | `**/*.e2e.ts` (ignores `visual-regression*` and `audio-transcription*`) | 2 on CI, 0 locally | Functional E2E tests |
| `transcription` | `**/audio-transcription*.e2e.ts` | 2 on CI, 0 locally | Env-gated: runs only with `ERFANA_E2E_TRANSCRIPTION=1` (real, paid OpenAI calls) |
| `visual` | `**/visual-regression.e2e.ts` | 0 | Screenshot comparison (diffs must be investigated) |
| `bench` | `**/*.bench.ts` | 0 | Env-gated: runs only with `ERFANA_E2E_BENCH=1`. Records performance numbers rather than asserting behaviour – see [docs/performance/](../performance/) (e.g. the [preview typing benchmark](../performance/2026-10-21-deferred-preview.md)) |

Visual project settings: `snapshotDir: './e2e/screenshots'`, `snapshotPathTemplate: '{snapshotDir}/{arg}-{platform}{ext}'`, `maxDiffPixelRatio: 0.01`, `animations: 'disabled'`.

The visual fixture pins the window's content size (`VISUAL_CONTENT_SIZE` in `e2e/fixtures/index.ts`) after the window exists, and throws if the window
manager does not grant it (#267). Page-level captures (welcome, editor, terminal) pass `clip: PAGE_CLIP`, a fixed `1280x800` rectangle. Element-level captures (settings overlay, confirm dialog,
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
| `MonacoPage` | Editor interactions – `waitForReady()`, `focus()`, `setContent()`, `typeWithoutWaiting()` (insert at the cursor with no waits, for edits followed at once by another action), `getContent()`, `visibleText()` |
| `MermaidPage` | Mermaid diagram interactions |
| `ProjectTreePage` | Project tree navigation, git decorations, toolbar buttons, and the row context menu – `fileRow()` / `folderRow()`, `waitForFile()` / `waitForFileGone()`, `newFileButton()` / `newFolderButton()` / `refreshButton()` / `closeProjectButton()`, `emptyState()`, `openContextMenu()` / `contextMenuItem()` / `runContextMenuAction()`, and the Welcome-tab recents – `recentProject(name)` / `switchToRecent(name)` |
| `DialogPage` | The modal surfaces – `ConfirmDialog` (`waitForConfirm()`, `accept()`, `decline()`) and the shared name-entry dialog behind New File / New Folder / Rename (`waitForNameEntry()`, `nameInput()`, `submitName()`, `validationError()`). The confirm dialog has testids; `FileSystemDialog` has none, so its controls are addressed by role and visible label |
| `TabBarPage` | Editor tab bar – `tab(fileName)`, `activeTab()`, `dirtyDot()`, `closeButton()`, `welcomeTab()`, `waitForTab()` / `waitForTabGone()`, `expectActive()`, `activate()`, `runContextMenuAction()` (Close / Close Others / Close All). Tabs are addressed by the filename they display, not by their path-hashed testid |
| `EditorPanelPage` | Markdown editor panel – the four view modes (`setViewMode()`, `isViewModeActive()`), the formatting buttons (`format()`), the status indicators (`modifiedIndicator()`, `autosaveIndicator()`, `reloadIndicator()`), the stats bar, and the file-conflict notification |
| `SearchBarPage` | Find bar – `waitForOpen()` / `waitForClosed()`, `search()`, `matchCount()` / `waitForTotal()` / `waitForOrdinal()`, the case and whole-word toggles, next/prev/close |
| `ImageViewerPage` | Image viewer tab (#70, extended for #73) – `openFromTree()`, `waitForReady()`, `marker()` / `waitForMarker()`, `zoomIn()`, `transformStyle()`, `expectStatusState()`, `expectBanner()` / `expectNoBanner()`, `clickReload()`, `enterFullScreen()` / `exitFullScreen()`. Export (#73): three panel-scoped locators `exportPngButton()` / `exportPdfButton()` / `copyButton()`, their overlay-scoped twins `fullScreenExportPngButton()` / `fullScreenExportPdfButton()` / `fullScreenCopyButton()`, the `exportStatus()` polite live region (the assertive `image-viewer-export-alert` region has no POM locator — query it directly), plus `clickExport()`, `expectExportBusy()` and `expectExportAnnouncement()` |
| `ImageViewerNarrowPage` | Extends the above for the narrow-width toolbar contract (#73) – `toolbar()`, `controls()`, `constrainPanelWidth()`, `toolbarScrollMetrics()`, `panelScrollLeft()`, `focusedTestId()`, `expectWithinPanel()`. A separate file only because the base POM is near the 500-line cap |
| `ImportToolsPage` | Settings → Import tools section (#250) – `section()`, `row(format)` for `pdf` / `office` / `images` (each row carries `data-format` and `data-state`: `checking`, `unchecked`, `ready`, `missing` or `unsafe`), `recheckButton()`, `liveRegion()`, `waitForSettled(format)` (waits for `ready`, `missing` or `unsafe` and returns it) and `checkAgain()` (presses Check again and waits for the button to be enabled again). Not a composed fixture – `import-tool-status.e2e.ts` constructs it |
| `HtmlPreviewPage` | HTML preview (#111) – takes `(page, app)` because the previewed page runs in a sealed `WebContentsView` and is read main-side: `open()` (path-exact, waits for the `erfana-preview://` web contents), `snapshot()` / `eval()` / `livePreviews()` / `waitForTitled()` (address one of several with `HtmlPreviewPage.target(relPath)`), `clickInPreview()` (untrusted, `will-navigate` path) vs `clickTrusted()` (real input event – the only way to a gesture-gated path such as an external link), `viewBounds()` (`{ x, y, width, height, visible }`, window content DIP – `x` and `y` because a view can keep the right size at the wrong place). The native-view reads are plain functions taking the `ElectronApplication` in `e2e/pages/html-preview.native.ts` (#124 split); the class methods are one-line delegates. DOM chrome: `placeholder()` / `panel()` / `stillFrame()` / `tab()` scoped by basename (the placeholder name is `HTML preview of <basename>`, followed by ` – press Enter …` while the page can be entered from the keyboard; both match), the failure badge, and the permission band (`chip()`, `openBand()`, `hostRow()`, `allowButton(origin)`, `confirmDialog()` / `confirmButton()` / `cancelButton()`, `allowedSection()`). Not a composed fixture – construct it in the test. Companions: `e2e/fixtures/localServer.ts` (ephemeral loopback server + `localServer` fixture) and `e2e/fixtures/logTail.ts` (condition-based read of what the worker's `~/.erfana/logs/main.log` gains after a mark; `new LogTail(appMainLogPath(homeDir))`) |
| `html-preview.native.ts` | The native-view reads behind `HtmlPreviewPage` (#124 split) – plain functions taking the `ElectronApplication`, read main-side: `previewSnapshot()`, `livePreviews()`, `evalInPreview()`, `clickInPreview()`, `clickTrusted()` and `viewBounds()`. The class methods of the same names are one-line delegates |
| `html-preview.frames.ts` | HTML preview frames (#124, part 2) – plain functions (like `html-preview.native.ts`, because `HtmlPreviewPage` keeps its app handle private): `frameTree()` (every frame with depth, URL and `document.title`, read main-side), `evalInFrame()` (a read), `clickInFrame()` (a click queued in the frame, so a navigating link cannot hang the call), `armFrameTrail()` / `readFrameTrail()` / `writerOf()` (which layer wrote a refused-frame entry, from Electron's own frame signals), `waitForBadgeCount()`, `readBadgeGroups()`, `resetHostZoom()`; `dismissToasts` re-exports the shared `dismissAllToasts`. The reads and clicks in frames are the test's own – the product runs no script in a page's frames |
| `html-preview.browser.ts` | "Open in default browser" (#124, part 4) – the launch seam: `armBrowserSeam(app, mode)` (`answer` / `hold` / `throw`), `setBrowserSeamMode()`, `releaseBrowserSeam()`, `browserSeamCalls()` / `waitForBrowserSeamCalls()`, `stubBrowserLookup()` (a fixed default-browser path, or `'reject'` to force the fallback), `expectedBrowserLaunch()`; plus `openInBrowserButton()`, `toastsOf(page, type)`, `dismissAllToasts()`, `rendererPlatform()` / `revealCommandFor()` |
| `html-preview.navigation.ts` | Same-tab links and history (#124, part 3) – panel-scoped chrome (`backButton()`, `linkModeToggle()`, `moveAnnouncement()`, `previewTabs()`, `turnSameTabOn()`), main-side reads (`livePages()` / `waitForLivePages()`, `waitForPage()`, `scrollState()`, `previewZoomLevel()`), real input inside the page (`clickLink()` with `button` and `accel`, `pressNavKeyInPage()`, `navChord()`, `zoomInPreview()`) and save-dialog recording (`recordSaveDialogs()` / `savedDialogNames()`). Still holds its own `dismissAllToasts` copy (technical debt) |
| `html-preview.focus.ts` | Keyboard focus into a previewed page and back (#124, QG-8 U1 and QG-11a H1) – plain functions taking the `ElectronApplication`, like `html-preview.native.ts`: `bandChip()`, `bringAppToFront()` (makes Erfana the OS key window and **fails** when the OS will not, naming the locked screen or inactive session as the cause), `focusState()` (native focus read main-side with `webContents.isFocused()` for the preview and its host window – `document.activeElement` cannot tell), `pressKeyInPage()` (real input through `webContents.sendInputEvent`; Playwright's `page.keyboard` drives the host and never reaches the page), and `recordHostFocusTrail()` / `hostFocusTrail()` (the order of host `focus()` calls and forwarded shortcuts, observable without OS focus) |
| `html-preview.comments.ts` | HTML Preview comments (P3, P4; docs/designs/html-preview-comments.md §12.4) – plain functions taking the `ElectronApplication`: `commentLoads()` and `commentUnavailable()` read the main-side e2e hook `globalThis.__erfanaE2eComments` (installed only in an unpackaged build with `ERFANA_E2E_TEST_HOOKS=1`, which the fixtures set), never the page's markup; `newestLoad()` / `namesFile()` / `waitForCommentLoad()` pick a file's load; `DOM_TOKENS_EXPR` reads the `data-erfana-el` tokens left in the live DOM – none since P4, the preload strips them. **Comment stub (P4)**, standing in for main's comment handlers until P5: `armCommentStub()` / `commentStubRecord()` record the picks and anchor reports the page's frames send on `webContents.ipc`, `sendCommentState()` sends one frame a `preview-page:commentState`, `enterStubCommentMode()` turns the mode on and waits for the overlay (`OVERLAY_HOSTS_EXPR`, which also proves the host's shadow root is closed), `OVERLAY_HOST_EXPR` / `OVERLAY_HOST_OPEN_EXPR` name the host and read whether it is in the top layer (for a page that fights it), `overlayReportedUnavailable()` reads whether a frame said `overlay: 'unavailable'`, `clickAt()` / `pickAt()` are a frame-aware trusted click and the pick it sent, and `accentPixelsNear()` counts the pin colour in `capturePage()` pixels at an element's top-right corner – the closed shadow root's only outside view |
| `html-preview-bounds.harness.ts` (in `e2e/`) | Not a page object: the shared harness of the two bounds specs (#124, part 1) – a `bounds` fixture (`BoundsHarness`: the native view read main-side in DIP against its placeholder in CSS px, the layout moves the specs share, `sashNear(x)`), `LogTrail` (the drop-reason lines a test produced) and the seeded page. "Settled" means two reads 100 ms apart agree |

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
| `homeDir` | Worker | Sandbox home (`HOME` / `USERPROFILE`); `~/.erfana` and its logs live inside it |
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
| `appWithTestProject` | Test | Launches Electron with **no** project argument, then opens `testProject` over IPC (`window.api.file.openProjectByPath`). The main process does not parse a project path from argv, so the older argv form silently fell back to electron-store's last-opened project |
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
Worker: userDataDir, homeDir
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

### Test-data isolation: user data, home and environment

Every fixture launch is isolated three ways (`e2e/fixtures/isolation.ts`):

- **`--user-data-dir`** isolates electron-store data (recent projects, project filter mode) and the renderer's `localStorage`.
- **A per-worker sandbox home (`homeDir` fixture).** `GlobalSettingsService`, `ApiKeyService` and `LoggingService` derive `~/.erfana/` from `os.homedir()`, and the Claude Code status reader uses `~/.claude`, so the app is launched with `HOME` / `USERPROFILE` (plus `APPDATA`, `LOCALAPPDATA` and the `XDG_*` folders) pointing inside `.e2e-temp/home-<worker>-*`. The developer's real home is never read or written, and two workers never share it. `LogTail` / `LogTrail` read the log under `appLogsDir(homeDir)` – pass the fixture's `homeDir`, never `os.homedir()`.
- **A minimal environment.** `buildAppEnv({ homeDir })` builds the app's environment from an allowlist (PATH, locale, display and Windows basics, plus `ERFANA_*` / `LC_*`; no `ELECTRON_*`), not from `...process.env`, so runner secrets do not reach the app or the shells its terminal spawns. `OPENAI_API_KEY` is dropped from the runner in `playwright.config.ts` unless `ERFANA_E2E_TRANSCRIPTION=1`, and only the transcription spec passes it on (`buildAppEnv({ extra })`).

Every launch – fixture or a spec's own `electron.launch` – also appends `E2E_CHROMIUM_ARGS` from the same file. On Windows it is `--disable-features=CalculateNativeWinOcclusion`: Chromium stops rendering a window that another one covers, and with two workers the app windows overlap, so the covered app froze mid-test (no frames, no ResizeObserver, no `requestAnimationFrame`). A new launch site must append it too ([known flakes](../windows/known-flakes.md)).

The home is per **worker**, so tests in one worker still share it; a spec that CHANGES a global setting and needs a clean slate per launch gives that launch its own home, as `settings-persistence.e2e.ts` does (`HOME` / `USERPROFILE` on top of `buildAppEnv()`).

Teardown (#134): the `app` fixtures wait for the Electron process to exit (`closeAppAndWait`) before the dependent temp folders go, and folders are removed with `removeDirWithRetry` (`fs.rm` with `maxRetries` / `retryDelay`), which covers Windows keeping handles open for a moment. Specs that still call `electron.launch` themselves with `...process.env` have not moved to the allowlist yet.

### Reading editor content: `getContent()` vs `visibleText()`

`MonacoPage.getContent()` reads the whole document from the Monaco **model**
of the editor its locator resolves, through the app's e2e test hook
(`window.__erfanaTest.editorValue(container)`, registered in
`MonacoMarkdownEditor` by `registerTestEditor`). Like the terminal hook it is
installed only for an unpackaged app launched with `ERFANA_E2E_TEST_HOOKS=1`,
which `buildAppEnv()` sets for every fixture launch. It does not touch focus,
selection or the clipboard. It used to select all, copy and read the
clipboard, which is machine-wide and could return the PREVIOUS copy, so an
assertion could pass against a stale buffer (lens review finding 37). It throws
while no editor has mounted in the container, so pair it with `expect.poll`
when the content is still changing.

`MonacoPage.visibleText()` reads Monaco's own `.view-lines` DOM – what the user
sees. The trade-off is virtualization: only lines near the viewport are in the
DOM, so it fits a phrase in a short fixture, not a whole long document. Pair it
with `expect.poll`, since `waitForReady()` only proves the editor is attached
and Monaco paints its lines a frame or two later.

### Script calls into a page: bounded `executeJavaScript`

`webContents.executeJavaScript` and `WebFrameMain.executeJavaScript` have no
timeout, and neither has `ElectronApplication.evaluate`. A call whose document
is replaced under it (a link just followed, a frame navigating, a view being
evicted) can stay pending forever and stall the caller's poll past its own
deadline (#255). So every such call goes through `e2e/utils/bounded-exec.ts`:
`await installBoundedExec(app)` first (once per app, idempotent), then, inside
the `app.evaluate` callback,
`(globalThis as unknown as BoundedExecGlobal).__erfanaE2eExec(target, code, capMs, label)`.
A call that misses its cap rejects with a `BoundedExecTimeout`
(`<label>: executeJavaScript did not settle within <n> ms`); every other
rejection is re-raised as an `Error` prefixed with the label. Reads
(`EXEC_READ_CAP_MS`) tolerate only the timeout and a target that was destroyed
or disposed under them (`__erfanaE2eTolerable`): they report "nothing yet" and
the caller polls again. A script error (Electron reports a `webContents` one as
`Script failed to execute …`, a frame one as the bare error text) is rethrown
and fails the test. The read helpers remember the last failure they tolerated,
and `HtmlPreviewPage.withReadError(poll)` adds it to a failing poll's message.
Actions (`EXEC_ACTION_CAP_MS`) catch nothing. A click that navigates its own
frame is queued in the page (`clickInFrame`), so the call answers before the
document goes; `true` then means only "queued", and the test must assert an
effect of the click.

A direct `executeJavaScript` call anywhere under `e2e/` other than that file is
a lint error (`no-restricted-syntax` in `eslint.config.mjs`). The rule bans the
reference, not just the call, so an alias, `.call` / `.bind` and a destructure
are caught too. The one other
copy is the bench driver `e2e/fixtures/terminalHiddenFloodDriver.cjs`, which
runs outside Playwright and bounds its own calls.

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

Four `ERFANA_E2E_*` variables change app behaviour for tests. They are read by the app, not by Playwright, so they belong in the environment of the launched Electron process (`ERFANA_E2E_FORCE_CRASH`, `ERFANA_E2E_FAST_SHELL`, `ERFANA_E2E_BROWSER_SEAM`) or of the Playwright run itself (`ERFANA_E2E_TRANSCRIPTION`, a project gate):

| Variable | Effect |
|----------|--------|
| `ERFANA_E2E_FORCE_CRASH=1` | Launcher-only crash injection for `root-error-boundary.e2e.ts`: main appends `--erfana-force-crash` to `webPreferences.additionalArguments`, the preload re-exposes it as `window.__ERFANA_FORCE_CRASH__`, and `ForcedCrash` in `App.tsx` throws during render. Gated on `!app.isPackaged`, so packaged builds ignore it; the renderer can never set it |
| `ERFANA_E2E_BROWSER_SEAM=1` | #124: in an unpackaged build only, a function at `globalThis.__erfanaE2eBrowserLaunch` in the main process replaces the real browser launch and receives `{ via, appPath, filePath }` (`browserLauncher.ts`; `app.isPackaged` is checked first). `html-preview-open-in-browser.e2e.ts` sets the variable in `test.beforeAll` (the fixtures launch Electron with `{ ...process.env }`) and restores the worker's value in `test.afterAll`; each test then arms a recording seam (`armBrowserSeam`), which refuses to arm unless the variable really reached an unpackaged app, and stubs the default-browser lookup, so no test ever starts a browser |
| `ERFANA_E2E_FAST_SHELL=1` | POSIX only: the PTY bootstrap execs `/bin/sh -i` instead of `exec -l "$SHELL" -i`, skipping user rc files so terminal specs start in tens of milliseconds rather than seconds |
| `ERFANA_E2E_TRANSCRIPTION=1` | Enables the `transcription` Playwright project (real, paid OpenAI calls; also needs `OPENAI_API_KEY`). Without it the project matches nothing and the `capability-summary` reporter prints a `SKIPPED CAPABILITIES` line |

`ERFANA_TEST_BUILD=true` is a *build*-time variable, not a test-time one – see [Test build vs production build](#test-build-vs-production-build) above. Canonical table: [Testing overview § E2E environment variables](./README.md#e2eui-playwright-electron).

### Test files

All 66 specs in `e2e/` (`ls e2e/*.e2e.ts | wc -l`, counted 2026-10-25). The three `*.bench.ts` files beside them belong to the `bench` project (see the table above) and are not listed here:

- `app-launch.e2e.ts` – Application launch, activity bar, welcome panel visibility
- `file-operations.e2e.ts` – Project tree file management: New File / New Folder from the toolbar, Rename and Delete from the row context menu, Copy + Paste, and the cancel path of each. Every assertion is made twice — against the tree AND against the filesystem — because a tree that disagrees with disk is the failure this file exists to catch. Two named behaviours are pinned rather than assumed: `createFile` appends `.md` when the typed name has no markdown extension, and it refuses to overwrite an existing file (the test asserts the existing bytes survive)
- `tab-lifecycle.e2e.ts` – Editor tabs: open / reuse / switch, the per-panel dirty dot, and the unsaved-changes gate in front of **every** close path (close button, ⌘W, Close Others, Close All). Each "closed a dirty tab" case asserts on disk as well as on screen. Carries the regression guard for the multi-panel keyboard bug — dockview keeps every opened panel mounted, so one ⌘W used to be handled once per open tab and closed them all
- `editor-save.e2e.ts` – Autosave reaching real disk, manual save (⌘S) writing only the ACTIVE file, and the file-changed-on-disk conflict: banner, "Reload from Disk", "Keep My Version", and the absence of a conflict for the app's own save. The reload case also asserts `RootErrorBoundary` is absent — that button used to crash the renderer
- `markdown-toolbar.e2e.ts` – The four view modes (a file opens in **preview**, so Monaco is not mounted until the view is switched), a document surviving a full round trip of modes, the wrap/heading/list formatting commands against the real editor, and the document statistics footer including selection stats
- `search-bar.e2e.ts` – Find in document: opening via ⌘F (capture phase, so Monaco's own widget never wins) and via the toolbar, match counting, next/prev with wrap-around, the case-sensitivity toggle changing the total, closing, and the query resetting when a different file is opened. Covers both the Monaco and the rendered-preview providers
- `settings-persistence.e2e.ts` – Settings overlay sections and control dependencies, plus four settings asserted across a genuine restart (the app is launched twice against one user-data dir). Owns its launches, and gives each one an isolated `HOME` — see the isolation note below
- `workspace-layout.e2e.ts` – The workspace shell: activity-bar toggles, ⌘B / ⌘J panel shortcuts (and ⌘J being inert with no project), the markdown-only tree filter, the recent-projects list and its remove button, and four empty states

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
- `html-preview-bounds.e2e.ts` – #124 part 1: the native page stays on its placeholder. Each test moves the layout one way (squeezing the editor, a tree-splitter slide, the terminal expanded over the editor, a second window's zoom, window resizes and maximize, the find bar, the permission band's list), waits for two reads 100 ms apart to agree, and checks the view's rectangle against the placeholder's, scaled by the host zoom and inset by the find bar. The four symptoms it first reproduced (C1 ×2, C2, C3) ran as `test.fail` until fixed and are now plain regression checks; drop-reason lines are attached per test. Helpers in `html-preview-bounds.harness.ts`
- `html-preview-drag-freeze.e2e.ts` – #124 part 1 §1.5: during a splitter drag the page is hidden until main confirms, moves are held until then, and the page returns after the release; it is never drawn over the toolbar, the tree or the terminal. A window-edge drag is unit-tested (`setSize` fires no `will-resize`), and the page swallowing the `pointerup` stays manual
- `html-preview-frames.e2e.ts` – #124 part 2, on the `frames/` corpus: same-project `src` and `srcdoc` frames run script, CSS and images sealed from their parent, and saving what a frame uses reloads the preview; a host blocked inside a frame reaches the permission band; refused frames are listed on the badge with the layer that wrote each entry (`writerOf`); the depth and count caps, `srcdoc` frames past them shown and listed; a link inside a frame changes only the frame. The symlink `escape.html`, `node_modules/`, `.hidden/` and a `.gitignore` are made in setup, never committed; the expected label for `escape.html` is platform-aware
- `html-preview-open-in-browser.e2e.ts` – #124 part 4: the tree item (second, after "Open as source", then a separator) and the toolbar button hand the file's REAL path to the launch seam; after a same-tab move the button sends the page the tab shows now; `aria-disabled`, never `disabled`, while busy; the fallback's info notice and the failed launch's error toast. Expected paths go through `realpath` (macOS temp folders resolve `/var` → `/private/var`)
- `html-preview-same-tab.e2e.ts` – #124 part 3, on `design-set/`: the link table with the link mode on and off (a plain link follows the mode; `_blank`, Cmd/Ctrl-click and middle-click always open a new tab), mode inheritance, and a moved tab's title, tooltip, close label, `#section`, badge, watcher reloads, Find, PDF name and zoom all following the new page
- `html-preview-same-tab.history.e2e.ts` – #124 part 3 (split from the spec above): one file per tab (a move closes the other tabs showing the page, asking first for an unsaved editor), Back and Forward from the button and from the keys in the page and in the toolbar, a deleted page dropped from history, the failed banner a move caused, and what a page may do to history on its own – a step with no input behind it replaces the current entry, one click buys one entry, `pushState` to another page throws. `extra/page-N.html` and the over-budget `design-set/huge.html` (refused with 413) are made in setup
- `html-preview-keyboard-focus.e2e.ts` – #124 (QG-8 U1, QG-11a H1): Enter on the placeholder gives the page native keyboard focus and Tab reaches its field; Escape in the page hands native focus back to the host window and DOM focus to the band chip. The first test reads native focus main-side, so it needs Erfana to be the OS key window – run it on an unlocked screen; on a locked screen or inactive session it fails in `bringAppToFront`, naming that cause. The second needs no OS focus: it records that the host was told to take focus before Escape was forwarded. Helpers in `html-preview.focus.ts`
- `context-menu-keyboard.e2e.ts` – #90: context menus work from the keyboard. Shift+F10 on a tree row opens its menu with focus on the first item; the arrows move with wrap, Home / End jump, typing jumps to an item, and Escape closes it and returns focus to the row. On a dock tab, Tab closes the menu and returns focus to the tab
- `deleted-folder-tabs.e2e.ts` – #252: a tab whose file vanishes where the project watcher cannot see it (inside the ignored `dist/`) is marked deleted, and a file brought back with "Save to restore it" is watched again, so a later outside edit reaches the editor
- `dialog-focus-and-recents-keyboard.e2e.ts` – #91: a modal dialog keeps Tab inside itself and gives focus back to what opened it, focus returns to the tree after a context-menu dialog, and ([24]) a recent project opens with the keyboard alone. Needs real Chromium tabbing, which jsdom does not do
- `document-import-libreoffice-headless.e2e.ts` – an Office import starts LibreOffice with `--headless` and, on Windows, with no visible window. Skipped when LibreOffice is not installed
- `editor-busy-typing.e2e.ts` – no keystroke is dropped while the renderer is busy: a large file, a deliberately slowed React commit and a burst of typed keys
- `editor-outside-change.e2e.ts` – an outside change to a clean tab (or "Reload from Disk") keeps the cursor, adds one undo step and leaves the tab clean
- `import-tool-status.e2e.ts` – #250: Settings → Import tools shows each format's status before any file is picked, with an install hint only for a missing LibreOffice; Check again re-runs detection (rate-limited) and works from the keyboard; an import refusal opens Settings at Import tools. Host-independent – it stubs LibreOffice as missing rather than relying on what is installed. Uses `ImportToolsPage`
- `escape-topmost-dialog.e2e.ts` – #229: one Escape closes only the topmost dialog or overlay, using real stacked `ConfirmDialog`s raised through the app's `app:dialog` event
- `file-ipc-path-checks.e2e.ts` – the file channels refuse paths outside the open project, and a link inside it that leads out, when called through the real `window.api.file` bridge; the outside folder stays untouched and an ordinary call still works
- `fixture-teardown.e2e.ts` – #63: `closeAppAndWait` does not wait forever on a `close()` that never settles, and on Windows its kill also ends the child processes. Uses a fake app wrapping a real Node process, not Electron
- `preview-deferred.e2e.ts` – finding [31]: the Markdown preview renders behind the editor (deferred, and debounced for a large document) yet still ends up showing exactly what was typed, with anchors, link styling, front matter and diagrams
- `preview-images.e2e.ts` – #71: images referenced from Markdown paint in the preview, asserted on decoded pixels (`naturalWidth`), through the real confinement check and directory watcher
- `project-switch-unsaved.e2e.ts` – unsaved tabs are saved before a project switch or close; only a tab that cannot be saved reaches the prompt, and "Switch Anyway" leaves it without a late autosave write
- `quit-shutdown.e2e.ts` – #305: both ways of quitting run the shutdown to its last log line, with the terminal service disposed first
- `reduced-motion.e2e.ts` – #96: under `prefers-reduced-motion: reduce` every keyframe animation in the shipped stylesheets runs once and ends at once, while without the preference it still loops
- `save-after-folder-rename.e2e.ts` – a tab whose folder was renamed outside the app is marked deleted; autosave then fails visibly without recreating the folder, and "Save to restore it" writes the file back to its original path
- `target-size.e2e.ts` – #96 (WCAG 2.2 SC 2.5.8): pointer targets measure at least 24 x 24 – some in the real UI, the rest as probes styled by the shipped stylesheet
- `terminal-prompt-detection.e2e.ts` – #288: unit-style checks of when `TerminalPage.waitForPrompt()` counts a screen as a drawn prompt, on real xterm screen reads from macOS (zsh) and Windows (Git Bash). No app launch
- `terminal-screen-reader.e2e.ts` – lens review [23]: the Settings screen-reader override adds or removes xterm's accessibility tree in a running terminal without a restart, and is put back to Auto at the end
- `terminal-test-hook.e2e.ts` – the `window.__erfanaTest` hook that `TerminalPage.readScreen()` reads through is installed for the fixtures' launches
- `tree-clipboard-scope.e2e.ts` – [27]: the tree's Cmd/Ctrl+C / X / V act on the tree only when it has focus, so copying text elsewhere after clicking a folder copies the text
- `tree-keyboard.e2e.ts` – #87 / #88 / #89 and [33]: the tree is one Tab stop operated by arrows, Home / End, Enter, type-ahead and Shift+F10, shows the focus ring, mounts only a screenful of rows for a big folder, and still supports drag-and-drop with auto-scroll
- `visual-regression.e2e.ts` – Visual regression for 6 UI states (welcome, editor, terminal, settings, confirm dialog, image viewer toolbar in a narrow
  panel). State (f) uses its own extended test object so the image fixtures it seeds do not change the project tree in states (a)–(e)

> **Why the PDF geometry tolerance is one CSS pixel (#73).** Chromium's `printToPDF` quantizes a CSS `@page` size onto a 1/300 in grid, and for any
> dimension where `px % 8 === 6` the produced MediaBox comes back **0.54 pt larger** than requested. The gate's tolerance was originally 0.5 pt — tighter
> than Chromium's own output grid can express — so it refused roughly one pixel size in eight per axis, in every format, and the user got "the PDF page came
> out the wrong size, so nothing was written" for an ordinary image. `IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT` is now **0.75 pt**, exactly one CSS pixel at
> 96 dpi: still far too tight to admit letterboxing, scaling or multi-page output, all of which are off by whole page fractions. The `.jpg`, `.jpeg`
> (22 px tall) and `.bmp` (14 px tall) matrix rows sit on that grid and pass like any other row, on both surfaces; the `image export – PDF page-size grid
> regression` case holds the line with a **PNG** at 60 x 22, so a re-tightened tolerance fails there first.

> **HTML preview e2e notes (#124).**
> - **Toasts are found by `toast-<type>`.** A toast renders its test id as `` `${TEST_IDS.TOAST}-${type}` `` (`ToastNotification.tsx`), never the bare `toast` id; a helper waiting on the bare id never closes anything, and the "Project Opened" toast then covers the preview. Use `dismissAllToasts` / `toastsOf` from `html-preview.browser.ts`.
> - **Real input is in view pixels.** `webContents.sendInputEvent` takes view pixels while `getBoundingClientRect()` gives CSS pixels, so `clickLink` multiplies the point by `wc.getZoomFactor()`; a click that ignores the zoom misses as soon as a test zooms. A same-tab move and a history entry need that real input – `executeJavaScript` clicks are untrusted.
> - **The zoom test needs Erfana in front.** On macOS `app.focus({ steal: true })` is blocked while another app is frontmost, so "should keep the zoom level…" can fail for a reason outside the app (inferred from three failures before any move; seen again in a full macOS run on 2026-10-01 as `the preview could not take focus`, then 5/5 green with `--repeat-each=5 --workers=1`).
> - **A `.md` can open rendered.** Click `view-mode-btn-editor` before driving Monaco. To reach a file's end in Monaco on macOS press `Cmd+Down` – `Cmd+End` does not get there.
> - **Type-checking e2e files.** `tsconfig.e2e.json` covers `e2e/**/*.ts` and `playwright.config.ts`; run `npm run typecheck:test:e2e` (it is also part of `npm run typecheck`, so the required `Typecheck` job checks every spec, #109).

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

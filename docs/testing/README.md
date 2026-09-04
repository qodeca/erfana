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

#### Key test areas

Run `npm run test` for current totals. The workspace holds **464 test files**, and a full `npm run test:ci` reported **11,649 cases passing with 108 skipped** (11,757 collected). Both figures were counted on 2026-09-04 on a Windows host; re-run `npm run test:ci` for the live figure, since the case count moves with every commit while the file count is checkable with a glob. About **108 cases are skipped on a Windows host**, all of them in the `main` project: 77 in the POSIX-only `pathSecurity.test.ts`, 20 in `scripts/fuses.test.mjs` (the POSIX chmod and symlink cases), 5 in `projectConfinement.test.ts`, 5 across the file handlers, and 1 macOS-only `LiteParseConverter.test.ts` case. (`tarArchive.test.ts` gates its symlink case with an early `return` instead, so it reports as passing rather than skipped — which is why the coverage floors, not the test run, are what fail on Windows.) For the version-by-version test-addition history, see [`docs/CHANGELOG.md`](../CHANGELOG.md).

| Area | Key files | Docs |
|------|-----------|------|
| Terminal bootstrap & scroll | `TerminalService.test.ts`, `TerminalPanel.scroll.test.tsx` | [Terminal](../terminal/README.md) |
| Prompt system | `src/renderer/src/prompts/*.test.ts{,x}` (core, UI, regression) | [Prompts](../prompts/) |
| Dialog system | `FileSystemDialog.test.tsx`, `fileValidation.test.ts` | [Architecture – Dialog system](../architecture.md#dialog-system) |
| Transcription pipeline | Tests across `main/`, `renderer/`, `shared/` (spec 009) | [Transcription CLAUDE.md](../../src/renderer/src/components/Transcription/CLAUDE.md) |
| Document import | `LiteParseConverter.test.ts`, `DependencyDetector.test.ts`, `DocumentImportDialog.test.tsx`, `useDocumentImportStore.test.ts`, `import-handlers*.test.ts`, `LiteParseConverter.integration.test.ts` | [API services – features](../api-services-features.md) |
| ProjectTree & watchers | `*.logic.test.ts`, `*.pipeline.test.ts`, `*.switching.test.ts` | [Architecture – ProjectTree](../architecture.md#projecttree-modularization) |
| Local whisper (Phase 4) | `LocalWhisperService.test.ts`, `WhisperModelManager.test.ts`, `WhisperModelManager.downgrade.test.ts` + utility tests (`zipArchive`, `tarArchive`, `secureDownloader`, `verifyManifest`) | [Phase 4 test inventory](../windows/implementation-plan.md#phase-4-test-inventory) · [Trust chain](../windows/whisper-trust-chain.md) · [API services – features](../api-services-features.md) |
| Settings overlay | `SettingsOverlay.test.tsx` | [Settings](../settings.md) |
| Design system (`design/`) | `scripts/design-claims.test.mjs` (the claims ledger: re-derives every number a design card states, from `src/`, and fails naming the card that drifted — a card has nowhere to type a number by hand), `scripts/design-authority.test.mjs` (asserts a retired style-guide section stays a stub and cannot grow a rule back) | [`design/README.md`](../../design/README.md) · `scripts/lib/design-claims.mjs` |
| Build tooling | `scripts/fuses.test.mjs` (afterPack chmod helper — 9 cases: happy / idempotent / multi-arch / missing / empty+requireMatch / empty+lenient / symlink / dir / EROFS) | [Build – Fuses](../build/fuses.md#afterpack-also-chmods-node-pty-spawn-helper) |
| Error containment (#60) | `RootErrorBoundary.test.tsx`, `RootErrorFallback.test.tsx`, `PanelErrorBoundary.test.tsx`, `useDragDropTree.test.ts` (explicit-stack `flattenTree`), `rendererCrashHandlers.test.ts` (main-side crash/hang trail) | [UI components § Error containment](../ui-components.md#error-containment) · [`design-issue-60.md`](../design/design-issue-60.md) |
| Image viewer + single-file watch (#70) | Main: `FileWatcherService.atomicSave.test.ts`, `watcher/SubscriberCounter.test.ts`, `watcher/singleFileWatch.rename.integration.test.ts` (**real** chokidar + real `rename`, pins the platform's event sequence). Renderer: `hooks/useFileChangeSubscription.test.ts`, `hooks/fileWatchSlot.test.ts`, `utils/openFileInPanel.test.ts`, and the `ImageViewerPanel/` suite (`.test.tsx`, `.refresh`, `.status`, `.deleted`, `.integration`) | [File watching § Single-file watch internals](../file-watching/README.md#single-file-watch-internals-70) · [UI components § Image Viewer Panel](../ui-components.md#image-viewer-panel) |
| Image export – PNG / PDF / clipboard (#73) | Main: `services/imageExport/` (`imageMetadata`, `declaredDimensions`, `exportPaths`, `pdfGeometry`, `rasterizeSession`, `ImageRasterizeWindow`, `exportSinks`, and `ImageExportService` split across `.test`, `.errors.test`, `.sinks.test`), `utils/ExportLock.test.ts`, `ipc/image-export-handlers.test.ts`. Shared: `ipc/image-formats.test.ts`. Renderer: `ImageViewerPanel/imageExportToast.logic.test.ts`, `hooks/useImageExportHandlers{,.announcement}.test.ts`, `components/ImageViewerExportControls.test.tsx`, `ImageViewerPanel.export.test.tsx`, `ImageViewerPanel.toolbarOverflow.test.ts`. The rasterize harness itself is the one piece with no unit coverage — it only runs inside a real Chromium page, so it is proven by the four e2e specs that actually export (`image-export`, `image-export.behaviour`, `image-export.matrix`, `image-export.overlay-matrix`) and the manual checklist | [API services – features § ImageExportService](../api-services-features.md#imageexportservice) · [UI components § Image Viewer Panel](../ui-components.md#image-viewer-panel) · [Error codes § Image export](../error-codes.md#image-export-15-codes) |

**Testing patterns used**:
- "Extract Pure Logic" – business logic in `.logic.ts` files, tested without React overhead
- Factory functions for test data (`__test-utils__/`)
- jsdom + portal-root for modal/dialog component tests
- Mock `window.api` and `navigator.clipboard` for IPC/clipboard operations
- **`flakeGuard`** (`tests/setup/flakeGuard.ts`) — installed in all 3 setup files; surfaces unhandled rejections / uncaught exceptions firing post-teardown with full stack trace + scope label. If you see `[flakeGuard:<scope>] UNHANDLED REJECTION:` in stderr, fix the source (track + cancel the timer/promise on unmount, same pattern as #159)
- **Global `electron` mock for main tests** (`tests/setup/setupTests.main.ts`) — the `main` vitest project globally mocks `electron`, so a main test that transitively imports it (e.g. `ConverterRegistry` → `LiteParseConverter` → `import { app } from 'electron'`) never loads the real npm package, which throws `Electron failed to install correctly` when the runner's binary is missing. A per-file `vi.mock('electron', …)` still overrides the global default; extend the global stub if a new test needs an electron member it doesn't yet provide
- **Platform overrides** in tests use `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })` + restore in `afterEach` (NOT `describe.runIf` — that gates by host platform and skips on macOS CI)
- **Cross-platform paths** in test fixtures use `path.join(os.tmpdir(), 'erfana-test', ...)` (per #157) — hardcoded `/tmp/...` or `/path/to/...` strings break Windows `PATH_TRAVERSAL` validation
- **Test-file split policy** (when to split `<Source>.test.ts` into a second file) — see [`../windows/contributing.md`](../windows/contributing.md) §"Test-file split policy". Reference implementations: `WhisperModelManager.downgrade.test.ts` + `FileService.copyItem.limit.test.ts`. Rule: split when mocks hoist to module scope; keep in-file when fakes are per-describe-scoped
- **Windows-host flake register** — see [`../windows/known-flakes.md`](../windows/known-flakes.md) for symptom catalog, status, and remediation patterns (fake timers, mocked-fs splits, per-platform e2e budgets, offset-deque)
- **Crypto fixture pattern** — `verifyManifest.test.ts` uses a real published manifest + signature as fixture. Don't synthesise test manifests with test keypairs; refresh the fixture when the whisper pin advances. See [ADR 0002](../adrs/0002-minisign-over-cosign-sigstore.md)
- **Cross-cutting CSS-policy audits** (`*.audit.test.ts`) — verify a stylesheet contract that spans many component files without depending on jsdom's `getComputedStyle` (which is unreliable for non-standard properties like `user-select` — vitest #1689, #8017). Pattern: import each component CSS as raw text via Vite's `?raw` suffix (the renderer vitest project sets `css: true`), then `it.each` over an exported `AUDIT_<N>_SURFACES` constant and assert `new RegExp(escapedSelector + '[\\s\\S]{0,800}?user-select:\\s*text\\s*;')` matches the source. Reference: [`src/renderer/src/styles/userSelect.audit.test.ts`](../../src/renderer/src/styles/userSelect.audit.test.ts) (#211) covers 22 surfaces deterministically. Pair with a small organic E2E rather than per-surface E2E variants (the raw-CSS pass is the cross-cutting gate).
- **CPU probe mocking** — simulate pre-SSE4.2 CPUs in UI tests via `vi.spyOn(os, 'cpus').mockReturnValue([...])` + `__resetCpuProbeForTests()` before import. Pattern lives in `LocalWhisperService.test.ts` `describe('checkCpuSupport() pre-flight probe')`
- **Coverage gates and ratchet policy** — aggregate thresholds in the 3 vitest configs (`vitest.{main,preload,renderer}.ts`) currently sit at `lines/functions/statements: 10`, `branches: 5`. They are aggregate (`perFile: false`) and only fire under `--coverage` (`npm run test:cov`), not under `test:ci`. **Trust-chain modules** (`src/main/utils/{verifyManifest,secureDownloader,zipArchive,tarArchive}.ts`) carry per-file 90% floors in `vitest.main.ts` — these protect the whisper-binary download verification chain (ADRs 0001–0004). The threshold keys are **exact repo-relative paths, not globs**, so a per-file floor covers precisely the one file it names; alongside the four trust-chain modules the same block declares `scripts/fuses.js` (86 lines/statements, 88 functions, 93 branches), `src/main/services/claudeStatus/modelId.ts` (95% each metric) and `src/main/utils/rendererCrashHandlers.ts` (90% each metric). The per-file global gate (`perFile: true`) and a measurement-based floor raise are deferred until a clean coverage measurement is captured. The Windows blocker on that measurement is cleared: `scripts/fuses.test.mjs` has been platform-skipped since 2026-06-04 (`describe.skipIf(process.platform === 'win32')` on both top-level describes), so the suite itself runs on Windows hosts - but it still cannot pass there: the per-file floors for `scripts/fuses.js` and `src/main/utils/tarArchive.ts` are missed because both suites skip their symlink cases on win32, so the lines those cases would cover never execute. Run it on macOS or Linux, or read the `Coverage` CI job — see [`docs/windows/known-flakes.md`](../windows/known-flakes.md). **Ratchet pattern**: when raising floors, never set them to the measured value; set them to (measured − 5 percentage points, rounded down to nearest 5) so single-PR coverage dips don't break the build, then ratchet again after each cycle of new tests lands.

---

### E2E/UI (Playwright Electron)

**[e2e-testing.md](./e2e-testing.md)** – Comprehensive E2E testing guide

- Playwright setup and configuration for Electron (three projects in `playwright.config.ts`: `electron` functional, `transcription` env-gated, `visual` regression)
- Testing patterns for third-party components (Monaco, xterm.js, Mermaid)
- Complete selector catalog (256 testids) – see [e2e-selectors.md](./e2e-selectors.md)
- Test helper utilities documentation
- Troubleshooting guide

**E2E workflow is currently disabled on CI** (2026-04-25, commit `997ba65`) — both the functional `electron` and `visual` suites run locally only until the `macos-latest` instability is root-caused. See [docs/ci.md § E2E Tests (disabled)](../ci.md#e2e-tests-e2eyml-disabled) for the disable rationale and re-enable command.

**Commands**:
```bash
npm run test:e2e                   # Functional E2E tests (electron project) – local-only today
npm run test:e2e:visual            # Visual regression tests (visual project) – local-only
npm run test:e2e:update-screenshots  # Update visual baselines
```

**E2E test files** (all 30 specs in `e2e/`):
- `html-preview-corpus.e2e.ts` - HTML-preview corpus acceptance (#74): the fixture corpus renders, the native view is sized on open, and the process-isolation floor holds
- `html-preview-links.e2e.ts` - in-page links and independent previews (sd-074b): a new tab per target and reuse on a second click, `javascript:` refused, a link out of the project refused, `#anchor` scrolls; plus the external-link case, where an `https:` link asks first and the cancelled outcome is read back from the main log
- `html-preview-perf.e2e.ts` - the save-to-visible-change gate (sd-074b AC24), asserting the P95 against its budget
- `html-preview-approval.e2e.ts` - #111: nothing is fetched before approval, Allow then Confirm reaches a terminal state, the script loads inside the page, and the origin is written under `htmlPreview.allowlist.origins`. Uses the `localServer` fixture
- `html-preview-eviction.e2e.ts` - the fourth preview evicts the first to a still frame, and clicking its tab wakes it live again
- `image-export.behaviour.e2e.ts` - how image export behaves rather than what it produces: the viewer zoom must not reach the exported pixels
- `image-export.matrix.e2e.ts` - the per-format export matrix (#73 AC1): all three actions across the eight supported formats, from the panel
- `image-export.overlay-matrix.e2e.ts` - the same matrix run from the full-screen overlay, the second surface #73 AC1 requires
- `app-launch.e2e.ts` – Application launch, activity bar, welcome panel visibility
- `third-party-components.e2e.ts` – Monaco editor, xterm.js terminal, Mermaid diagrams
- `directory-watcher.e2e.ts` – Directory watcher pipeline (#104): verifies file creation via terminal appears in Project Tree within latency budget
- `context-menu-explain.e2e.ts` – Context menu Explain prompt flow: preview (selection gating, menu items, click-outside dismiss, Explain → terminal) and editor (disabled state, enabled after selection, Explain → terminal)
- `audio-transcription.e2e.ts` – Full audio import transcription lifecycle (real OpenAI API; runs only in the `transcription` project — see the env-var table below)
- `document-import.e2e.ts` – Document import dialog flow with PDF fixture (LiteParse)
- `welcome-open-toolbar-import.e2e.ts` – Welcome-screen Open/Change Project button (label toggle, real `file:openProject` IPC with the native dialog stubbed) and the Project Tree toolbar Import button
- `settings-logs.e2e.ts` – Settings overlay logs folder path display and Open button (#137)
- `fixture-smoke.e2e.ts` – Smoke tests for composed fixtures (testProject, withSettings, withOpenFile, appWithTestProject)
- `git-status.e2e.ts` – Git decorations in the Project Tree: file letter-badges, folder dots, priority bubbling (wiring smoke, not the #237 separator guard — that is the `gitStatus.logic.test.ts` unit suite)
- `git-status-on-edit.e2e.ts` – Badge refresh after an in-editor autosave, with no manual refresh: keystroke → autosave → chokidar `change` → IPC → store → row repaint
- `terminal-expand.e2e.ts` – Terminal maximize over the editor area (Cmd/Ctrl+Shift+M and the header button); covers AppDockLayout splitview manipulation that has no unit test
- `terminal-resize.e2e.ts` – Regression guard for the editor/terminal sash drag (real mouse drag; the editor area must actually shrink)
- `dockview-resize.e2e.ts` – Regression guard that dockview drag-to-resize survives CSS changes (#211 AC #7)
- `user-select.e2e.ts` – Organic selection coverage for #211 on two surfaces (markdown preview, settings overlay); the cross-cutting policy gate is `userSelect.audit.test.ts`
- `camera-mirror.e2e.ts` – Camera preview mirroring default + per-camera toggle, 16:9 `object-fit: contain` framing, native Enter-to-capture (#42); runs against Chromium's fake capture device and asserts the fake device is the one streaming
- `root-error-boundary.e2e.ts` – #60: a launcher-injected renderer crash must produce the recovery screen (details toggle, Copy / Open logs / Restart present) instead of a blank window, plus a negative case asserting the normal app renders when the crash flag is absent. Restart is asserted but never clicked — activating it relaunches the app mid-test
- `preview-refresh.e2e.ts` – #70: an open image tab repaints after an in-place rewrite and after an atomic replace, the status slot reaches `reloading` then returns to `idle`, zoom survives a same-size rewrite, a delete shows the banner and keeps the last image, and a `MutationObserver` proves there is no flicker. Uses `ImageViewerPage`; asserts the decoded `data-marker` rather than the raw `src`
- `preview-refresh-terminal.e2e.ts` – #70: an image path clicked in a terminal opens the image viewer, not Monaco. Separate spec because it needs `ERFANA_E2E_FAST_SHELL` on its own `electron.launch()` and because clicking a WebGL-rendered xterm link needs cell-grid geometry plus retries
- `image-export.e2e.ts` – #73, the *bytes* half: real pixel output for all eight supported extensions, an SVG rasterized at exactly 2x its intrinsic size, an animated GIF's first frame, a multi-size ICO's largest entry, PDF geometry (exactly one page, MediaBox = pixels × 0.75 pt — asserted with the same `verifyPdfGeometry` the runtime gate uses, so gate and assertion cannot drift), and alpha handling. Everything here needs a real Chromium decoder, which neither jsdom nor the electron-mocked main project has. Clipboard cases run serially, because the OS clipboard is a global resource
- `image-export.behaviour.e2e.ts` – #73, the *promises* half: the export follows the file rather than the panel (zooming changes nothing; rewriting the source between two exports changes everything), all three actions work from the full-screen overlay and announce into the in-overlay live region, and a cancelled save dialog writes nothing and says nothing. Split from the spec above so both stay under the 500-line cap; the native save dialog is stubbed with `stubDialog` rather than via a production test hook
- `image-export.matrix.e2e.ts` – #73: the PDF and clipboard columns of acceptance criterion 1's 3 x 8 format grid, run from the panel toolbar, each row asserting that format's own expected pixel size (the PNG column lives in `image-export.e2e.ts`). Also carries the PDF page-size grid-regression case, which holds the one-CSS-pixel MediaBox tolerance
- `image-export.overlay-matrix.e2e.ts` – #73: the same 3 x 8 grid run from the full-screen overlay, asserted through overlay-scoped locators and the in-overlay live region rather than a toast the `aria-modal` overlay would hide, including the per-format qualifier (GIF frame, ICO size, SVG 2x)
- `image-viewer-narrow.e2e.ts` – #73: the toolbar's narrow-width contract in a real Chromium layout — all eight controls stay visible and hit-testable at a 300 px panel, and Tab scrolls the rightmost one into view by scrolling the *toolbar*, with the panel container's `scrollLeft` asserted to stay 0
- `visual-regression.e2e.ts` – Visual regression for 6 UI states (see below)

**E2E environment variables**:

| Variable | Set where | Effect |
|----------|-----------|--------|
| `ERFANA_E2E_FORCE_CRASH=1` | Launch environment of the Electron process (the spec sets it per launch) | Makes the main process append `--erfana-force-crash` to `webPreferences.additionalArguments`; the preload re-exposes it as `window.__ERFANA_FORCE_CRASH__` and `App.tsx` throws during render. **Launcher-only** (the renderer cannot set it) and gated on `!app.isPackaged`, so a shipped build ignores it outright. Drives `root-error-boundary.e2e.ts`. See `buildAdditionalArguments()` in `src/main/index.ts` |
| `ERFANA_E2E_FAST_SHELL=1` | Launch environment | POSIX only: the PTY bootstrap execs `/bin/sh -i` instead of `exec -l "$SHELL" -i`, so no user rc files are sourced and terminal specs start deterministically (a heavy zsh framework can otherwise cost seconds). Production and any run without the variable are unchanged. See `TerminalService.createTerminal()` and [known issues](../known-issues.md) |
| `ERFANA_E2E_TRANSCRIPTION=1` | Shell running Playwright | Enables the `transcription` Playwright project (`audio-transcription.e2e.ts`), which makes real, paid OpenAI API calls; also needs `OPENAI_API_KEY`. Without it the project is `grepInvert`-ed to nothing, and the `capability-summary` reporter prints a `SKIPPED CAPABILITIES` line so the gap is auditable rather than a silent green tick |
| `ERFANA_TEST_BUILD=true` | Build environment (`npm run build:mac:test`) | afterPack (`scripts/fuses.js`) leaves `EnableNodeCliInspectArguments` **on** and renames the bundle with a "(TEST BUILD)" suffix. Required for `--inspect`-based debugging of a packaged app; never distribute such a build |

`OPENAI_API_KEY` (from `.env`, see `.env.example`) is the only credential any suite needs.

**Shared utilities**:
- POM classes in `e2e/pages/` – see [e2e-testing.md](./e2e-testing.md#pom-classes)
- Composed fixtures in `e2e/fixtures/index.ts` – see [e2e-testing.md](./e2e-testing.md#composed-fixtures)
- Locators in `e2e/utils/locators.ts`: `byTestId`, `byDynamicTestId`, `waitForTestId`, `waitForTestIdHidden`
- Wait helpers in `e2e/utils/wait-helpers.ts`: `waitForIpcComplete`
- Backward-compatible adapter in `e2e/utils/helpers.ts` – see [E2E Helpers](./e2e-helpers.md)

See Spec #011 (archived) for the specification.

### Visual regression (Spec #019, archived)

Screenshot-based comparison for 6 core UI states:
- **(a)** Welcome panel – empty project
- **(b)** Editor loaded – tree + editor + preview
- **(c)** Terminal open – split view with terminal
- **(d)** Settings overlay – full-screen settings
- **(e)** Confirm dialog – quit confirmation overlay
- **(f)** Image viewer toolbar – narrow panel (#73); the only case about a single row rather than a whole window, and it seeds its image fixtures through its own extended test object so states (a)–(e) keep byte-identical baselines

**Key details**:
- Baselines in `e2e/screenshots/` with platform suffix (e.g., `welcome-empty-darwin.png`). Both the `darwin` and the `win32` set are committed for all six states; the `win32` set was regenerated on 2026-09-04 after page-level captures were clipped
- Deterministic rendering: 1280x800 window, 1x DPR (`--force-device-scale-factor=1`), and page-level captures (a)–(c) pass `clip: PAGE_CLIP` — the same 1280x800 rectangle — so the baseline stops depending on whatever content size the host window manager actually granted. Element-level captures (d)–(f) need no clip
- Monaco cursor blink disabled; minimap and scrollbar masked
- A missing baseline does **not** skip: `assertBaselineExists()` throws, and `playwright.config.ts` sets `updateSnapshots: 'none'`, so nothing is auto-written on a first run. Generate a new platform's set with `npm run test:e2e:update-screenshots` and commit it
- `maxDiffPixelRatio: 0.01`, `retries: 0` (diffs must be investigated, not retried)
- CI records video on failure for debugging

See `specs/archived/spec-t2-019-visual-regression-ci/` for the full specification (archived spec).

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
2. Run functional E2E tests: `npm run test:e2e`
3. Run visual regression tests: `npm run test:e2e:visual`
4. Run visual scenarios in [test-scenarios.md](./test-scenarios.md)

### Learning Circuit Electron MCP
1. Start with simple flows from [test-scenarios.md](./test-scenarios.md)
2. Use screenshots to debug visually

---

## 📋 Prerequisites

For unit/integration: `npm ci` (vitest, Testing Library, and jsdom are already devDependencies), then `npm run test`.

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

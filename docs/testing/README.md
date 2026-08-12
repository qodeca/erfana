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

Run `npm run test` for current totals. The workspace holds **326 test files** — main 144 (`src/main` 132 + `src/shared` 10 + `scripts` 2), renderer 178, preload 4 — enumerated on `develop` on 2026-08-12, i.e. **v0.17.1 plus the unreleased #60 work**, not a released tag. That tree runs **9,694 cases** (verified on 2026-08-12); re-run `npm run test:ci` for the live figure, since the case count moves with every commit while the file count is checkable with a glob. ~78 cases platform-gate on Windows — 77 POSIX-only `pathSecurity.test.ts` + 1 macOS-only `LiteParseConverter.test.ts`. For the version-by-version test-addition history, see [`docs/CHANGELOG.md`](../CHANGELOG.md).

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
| Build tooling | `scripts/fuses.test.mjs` (afterPack chmod helper — 9 cases: happy / idempotent / multi-arch / missing / empty+requireMatch / empty+lenient / symlink / dir / EROFS) | [Build – Fuses](../build/fuses.md#afterpack-also-chmods-node-pty-spawn-helper) |
| Error containment (#60) | `RootErrorBoundary.test.tsx`, `RootErrorFallback.test.tsx`, `PanelErrorBoundary.test.tsx`, `useDragDropTree.test.ts` (explicit-stack `flattenTree`), `rendererCrashHandlers.test.ts` (main-side crash/hang trail) | [UI components § Error containment](../ui-components.md#error-containment) · [`design-issue-60.md`](../design/design-issue-60.md) |

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
- **Coverage gates and ratchet policy** — aggregate thresholds in the 3 vitest configs (`vitest.{main,preload,renderer}.ts`) currently sit at `lines/functions/statements: 10`, `branches: 5`. They are aggregate (`perFile: false`) and only fire under `--coverage` (`npm run test:cov`), not under `test:ci`. **Trust-chain modules** (`src/main/utils/{verifyManifest,secureDownloader,zipArchive,tarArchive}.ts`) carry per-file 90% floors via glob-keyed thresholds in `vitest.main.ts` — these protect the whisper-binary download verification chain (ADRs 0001–0004). The per-file global gate (`perFile: true`) and a measurement-based floor raise are deferred until a clean coverage measurement is captured. The Windows blocker on that measurement is cleared: `scripts/fuses.test.mjs` has been platform-skipped since 2026-06-04 (`describe.skipIf(process.platform === 'win32')` on both top-level describes), so `npm run test:cov` runs on Windows hosts — see [`docs/windows/known-flakes.md`](../windows/known-flakes.md). **Ratchet pattern**: when raising floors, never set them to the measured value; set them to (measured − 5 percentage points, rounded down to nearest 5) so single-PR coverage dips don't break the build, then ratchet again after each cycle of new tests lands.

---

### E2E/UI (Playwright Electron)

**[e2e-testing.md](./e2e-testing.md)** – Comprehensive E2E testing guide

- Playwright setup and configuration for Electron (three projects in `playwright.config.ts`: `electron` functional, `transcription` env-gated, `visual` regression)
- Testing patterns for third-party components (Monaco, xterm.js, Mermaid)
- Complete selector catalog (248 testids) – see [e2e-selectors.md](./e2e-selectors.md)
- Test helper utilities documentation
- Troubleshooting guide

**E2E workflow is currently disabled on CI** (2026-04-25, commit `997ba65`) — both the functional `electron` and `visual` suites run locally only until the `macos-latest` instability is root-caused. See [docs/ci.md § E2E Tests (disabled)](../ci.md#e2e-tests-e2eyml-disabled) for the disable rationale and re-enable command.

**Commands**:
```bash
npm run test:e2e                   # Functional E2E tests (electron project) – local-only today
npm run test:e2e:visual            # Visual regression tests (visual project) – local-only
npm run test:e2e:update-screenshots  # Update visual baselines
```

**E2E test files** (all 18 specs in `e2e/`):
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
- `visual-regression.e2e.ts` – Visual regression for 5 UI states (see below)

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

Screenshot-based comparison for 5 core UI states:
- **(a)** Welcome panel – empty project
- **(b)** Editor loaded – tree + editor + preview
- **(c)** Terminal open – split view with terminal
- **(d)** Settings overlay – full-screen settings
- **(e)** Confirm dialog – quit confirmation overlay

**Key details**:
- Baselines in `e2e/screenshots/` with platform suffix (e.g., `welcome-empty-darwin.png`)
- Deterministic rendering: 1280x800 window, 1x DPR (`--force-device-scale-factor=1`)
- Monaco cursor blink disabled; minimap and scrollbar masked
- Tests skip gracefully when no baseline exists for the current platform
- `maxDiffPixelRatio: 0.01`, `retries: 0` (diffs must be investigated, not retried)
- CI records video on failure for debugging

See `specs/spec-t2-019-visual-regression-ci/` for full specification.

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

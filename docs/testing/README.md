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

Run `npm run test` for current totals (~7,490 tests across 241 files as of v0.9.2).

| Area | Key files | Docs |
|------|-----------|------|
| Terminal bootstrap & scroll | `TerminalService.test.ts`, `TerminalPanel.scroll.test.tsx` | [Terminal](../terminal/README.md) |
| Prompt system | `src/renderer/src/prompts/*.test.ts{,x}` (core, UI, regression) | [Prompts](../prompts/) |
| Dialog system | `FileSystemDialog.test.tsx`, `fileValidation.test.ts` | [Architecture – Dialog system](../architecture.md#dialog-system) |
| Transcription pipeline | Tests across `main/`, `renderer/`, `shared/` (spec 009) | [Transcription CLAUDE.md](../../src/renderer/src/components/Transcription/CLAUDE.md) |
| Document import | `LiteParseConverter.test.ts`, `DependencyDetector.test.ts`, `DocumentImportDialog.test.tsx`, `useDocumentImportStore.test.ts`, `import-handlers*.test.ts`, `LiteParseConverter.integration.test.ts` | [API services – features](../api-services-features.md) |
| ProjectTree & watchers | `*.logic.test.ts`, `*.pipeline.test.ts`, `*.switching.test.ts` | [Architecture – ProjectTree](../architecture.md#projecttree-modularization) |
| Local whisper | `LocalWhisperService.test.ts`, `WhisperModelManager.test.ts` | [API services – features](../api-services-features.md) |
| Settings overlay | `SettingsOverlay.test.tsx` | [Settings](../settings.md) |

**Testing patterns used**:
- "Extract Pure Logic" – business logic in `.logic.ts` files, tested without React overhead
- Factory functions for test data (`__test-utils__/`)
- jsdom + portal-root for modal/dialog component tests
- Mock `window.api` and `navigator.clipboard` for IPC/clipboard operations

---

### E2E/UI (Playwright Electron)

**[e2e-testing.md](./e2e-testing.md)** – Comprehensive E2E testing guide

- Playwright setup and configuration for Electron (two projects: `electron` functional, `visual` regression)
- Testing patterns for third-party components (Monaco, xterm.js, Mermaid)
- Complete selector catalog (211 testids) – see [e2e-selectors.md](./e2e-selectors.md)
- Test helper utilities documentation
- Troubleshooting guide

**Commands**:
```bash
npm run test:e2e                   # Functional E2E tests (electron project)
npm run test:e2e:visual            # Visual regression tests (visual project)
npm run test:e2e:update-screenshots  # Update visual baselines
```

**E2E test files** (`e2e/`):
- `app-launch.e2e.ts` – Application launch, activity bar, welcome panel visibility
- `third-party-components.e2e.ts` – Monaco editor, xterm.js terminal, Mermaid diagrams
- `directory-watcher.e2e.ts` – Directory watcher pipeline (#104): verifies file creation via terminal appears in Project Tree within latency budget
- `context-menu-explain.e2e.ts` – Context menu Explain prompt flow: preview (selection gating, menu items, click-outside dismiss, Explain → terminal) and editor (disabled state, enabled after selection, Explain → terminal)
- `audio-transcription.e2e.ts` – Full audio import transcription lifecycle (real OpenAI API, requires `OPENAI_API_KEY`, skips if not set)
- `document-import.e2e.ts` – Document import dialog flow with PDF fixture (LiteParse)
- `settings-logs.e2e.ts` – Settings overlay logs folder path display and Open button (#137)
- `fixture-smoke.e2e.ts` – Smoke tests for composed fixtures (testProject, withSettings, withOpenFile, appWithTestProject)
- `visual-regression.e2e.ts` – Visual regression for 5 UI states (see below)

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

# Automated Testing Plan

This document outlines a practical, phased approach to introduce and scale automated testing for an Electron application with a React renderer and a preload bridge. The goal is to deliver value early, keep the suite fast and stable, and grow coverage without slowing teams.

## Approach
- Roll out in small, safe phases that deliver value early.
- Start with fast unit tests, then add IPC contract tests and E2E.
- Mock native and OS-specific dependencies in unit tests to avoid flakiness.

## Phase 0 — Align & Inventory
Objectives
- Pick scope, confirm tools, list critical flows.

Actions
- Confirm Electron + Vite + React stack and Node/Electron versions.
- Identify 3–5 critical flows for later E2E (e.g., project open/change, file open/save, terminal restart).

Deliverables
- Testing goals doc; agreed toolset and OS matrix.

Exit Criteria
- Alignment on test pyramid: mostly unit, a bit integration, few E2E.

## Phase 1 — Tooling Bootstrap
Objectives
- Install, configure runners without touching app code.

Actions
- Add: vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom.
- Create configs: vitest.workspace.ts, vitest.main.ts, vitest.preload.ts, vitest.renderer.ts.
- Add tests/setup/setupTests.renderer.ts and tsconfig.test.json.
- Package scripts: test, test:main, test:renderer, test:preload, test:watch.

Deliverables
- Green “no tests” run; CI job that invokes unit tests.

Exit Criteria
- `npm run test` executes across all three environments locally and in CI.

## Phase 2 — Seed Renderer Unit Tests
Objectives
- Prove jsdom + React Testing Library path works and is pleasant.

Actions
- Add `src/renderer/src/test-utils/renderWithProviders.tsx` to wrap common providers.
- Write 2–3 tests for a simple component and a store/hook.

Deliverables
- Passing renderer tests with jest-dom matchers.

Exit Criteria
- `npm run test:renderer` is green and stable.

## Phase 3 — Main Process Unit Tests
Objectives
- Test main logic with node environment; mock Electron APIs.

Actions
- Add `tests/mocks/electron.ts` minimal stubs for app, BrowserWindow, ipcMain, dialog.
- Write tests for pure services/utils (e.g., path canonicalization, watcher guards, project switching logic).

Deliverables
- Example main tests; guidance for mocking Electron/native modules.

Exit Criteria
- `npm run test:main` green; no native builds required.

## Phase 4 — Preload Contract Tests
Objectives
- Validate `contextBridge` exposure and IPC wiring.

Actions
- Add preload stubs for `contextBridge` and `ipcRenderer` under `src/preload/__mocks__/` or `tests/mocks/`.
- Test surface (e.g., `window.api.onProjectChanged`) including `string | null` typing for payloads.

Deliverables
- Passing preload tests asserting types and runtime shape.

Exit Criteria
- Preload functions covered with minimal happy-path and edge tests.

## Phase 5 — IPC Contracts & Integration Tests
Objectives
- Prevent drift between processes.

Actions
- Create `src/shared/ipc/schema.ts` with zod (or io-ts) schemas and exported TS types.
- Add small integration tests that parse/validate payloads on both sides.

Deliverables
- Shared schema module; a “contract test” suite.

Exit Criteria
- Payloads validated; type-safe imports in main/preload/renderer.

## Phase 6 — Coverage & Quality Gates
Objectives
- Measure, don’t gate yet.

Actions
- Enable Vitest coverage (c8) with low initial thresholds.
- Add reporters; upload artifacts in CI.

Deliverables
- Coverage reports by package/layer.

Exit Criteria
- Numbers visible in CI; no flakiness introduced.

## Phase 7 — Playwright Electron E2E (Smoke)
Objectives
- One stable end-to-end spec.

Actions
- Add @playwright/test, playwright.config.ts, e2e/specs/smoke.spec.ts.
- Launch Electron, assert main window renders, basic navigation works, and no console errors.
- Enable trace/screenshots on failure.

Deliverables
- Passing smoke spec locally and on CI (Linux to start).

Exit Criteria
- `npm run test:e2e` green; failures produce traces.

## Phase 8 — Expand E2E to Critical Flows
Objectives
- Cover 2–3 high-value journeys.

Actions
- Add specs: open/change project (terminal cwd verified), open/save file, terminal restart when project changes.
- Create fixtures for sample projects under `e2e/fixtures/`.

Deliverables
- Stable specs with deterministic data/clocks.

Exit Criteria
- E2E suite completes under 3–4 minutes; 10 consecutive green runs.

## Phase 9 — Refactor for Testability (As Needed)
Objectives
- Introduce seams, not broad rewrites.

Actions
- Wrap native deps (node-pty, chokidar, electron) behind tiny interfaces.
- Inject via factories so tests can swap in mocks.

Deliverables
- Adapter layer; unit tests no longer require native builds or OS-specific resources.

Exit Criteria
- Tests are hermetic; fewer global stubs and flakes.

## Phase 10 — CI Integration & Policy
Objectives
- Make tests part of PR hygiene.

Actions
- CI: run Vitest on every push; E2E on PR (Linux) and nightly for macOS/Windows.
- Add a PR check to block if unit tests fail; e2e initially informational, later required.

Deliverables
- Pipeline with caches and Playwright dependencies installed.

Exit Criteria
- Developers see quick feedback; traces attached on failures.

## Phase 11 — Stabilize & Raise Bars
Objectives
- Confidence without slowing teams.

Actions
- Flake hunts: rely on fake timers; centralize debounce/throttle helpers.
- Gradually raise coverage thresholds; add per-area owners and test checklists.

Deliverables
- Stable suite; documented guidelines.

Exit Criteria
- Consistent green builds; target coverage achieved.

## Supporting Infrastructure
Folder Structure (Hybrid)
- Co-locate fast unit tests near code:
  - `src/main/**/__tests__/*.test.ts`
  - `src/preload/**/__tests__/*.test.ts`
  - `src/renderer/src/**/__tests__/*.test.tsx`
- Centralize shared infra under `tests/`:
  - `tests/mocks/` (electron/chokidar/node-pty/fs)
  - `tests/fixtures/` (sample projects, symlinks, cross-OS paths)
  - `tests/helpers/` (createIpcMock, fakeTimers, deferred)
  - `tests/setup/` (setupTests.renderer.ts, main/preload env setup)
- E2E under `e2e/` with `specs/`, `helpers/`, `fixtures/`.

Configs (outline)
- `vitest.workspace.ts` → references per-target configs.
- `vitest.main.ts` → environment: node; include: src/main/**/*.test.ts.
- `vitest.preload.ts` → environment: jsdom; setup: tests/setup/setupTests.renderer.ts.
- `vitest.renderer.ts` → environment: jsdom; setup: tests/setup/setupTests.renderer.ts.
- `playwright.config.ts` → Electron launcher; traces on first retry; screenshots/videos on failure.
- `tsconfig.test.json` → extends base tsconfig; adds path aliases for tests.

Scripts
- `npm run test` — Vitest workspace (all projects)
- `npm run test:renderer|main|preload` — per-layer runs
- `npm run test:watch` — developer loop
- `npm run test:e2e` — Playwright Electron
- `npm run test:ci` — unit only, CI fast path

Risk Mitigation
- Native modules: always mock in unit tests; keep real validations to a few E2E specs.
- Watchers/time: centralize debounce/throttle utilities; test with fake timers.
- OS differences: keep path logic in shared utils; test with fixtures for Windows/macOS/Linux nuances.

## Phase 1 Quickstart

Install dev dependencies:

```bash
npm i -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom c8
```

Run tests (once everything is installed):

```bash
npm run test        # all projects (workspace)
npm run test:main   # main process tests
npm run test:preload
npm run test:renderer
```

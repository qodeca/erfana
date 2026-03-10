# Visual regression and CI resilience

## Overview

Erfana's Playwright config captures screenshots and traces on failure (`screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`) but does not use Playwright's built-in visual comparison capabilities (`toHaveScreenshot()`). Additionally, CI runs lack video recording for debugging and have no structured artifact management.

This spec adds visual regression testing for key UI states and hardens CI configuration for reliable, debuggable test runs.

### Scope

- Configure `toHaveScreenshot()` for essential UI states
- Create and manage baseline screenshots with platform-specific naming
- Enable video recording in CI for failure debugging
- Configure test artifact uploads and retention
- Define a CI workflow to host artifact management and visual regression runs
- Does NOT change test logic or selectors (see Specs #017 and #018)

### Related specs

- Spec #017 (Test ID coverage) – provides selectors that masking may use; if specific test IDs are not yet available, masking can use CSS class selectors as a fallback.
- Spec #018 (E2E infrastructure) – provides POM classes and fixtures that visual tests can benefit from, but is **not a hard prerequisite**. Visual tests can be implemented using the current fixture system in `e2e/fixtures.ts` and helpers in `e2e/utils/helpers.ts`. When #018 lands, visual tests should be migrated to use POM fixtures.

---

## Requirements

### Functional requirements

**019-FR-001: Visual regression for core UI states**
Configure `expect(page).toHaveScreenshot()` assertions for the following key UI states: (a) empty project – welcome panel, (b) project loaded – tree + editor + preview, (c) terminal open – split view with terminal, (d) settings overlay – full-screen settings, (e) dialog open – confirm dialog overlay. Each state must have a named screenshot with descriptive identifier.

Note: `toHaveScreenshot()` performs a two-pass stability check – it takes two screenshots with a brief pause and compares them for stability before comparing to the baseline. This is beneficial for detecting ongoing animations but adds ~1–2 seconds per assertion.

For overlay and dialog states (d, e), consider using element-level screenshots (`expect(locator).toHaveScreenshot()`) targeting the overlay/dialog container rather than full-page capture. This reduces masking complexity and produces smaller, more stable baselines. Full-page screenshots are appropriate for layout states (a, b, c) where the overall arrangement is the regression target.

**019-FR-002: Platform-specific baseline management**
Store baseline screenshots in `e2e/screenshots/` with platform suffix in filename. Playwright's `toHaveScreenshot()` stores baselines in `{testFile}-snapshots/` by default. To use `e2e/screenshots/`, configure `snapshotPathTemplate` in `playwright.config.ts`:

```ts
snapshotPathTemplate: '{snapshotDir}/{arg}-{platform}{ext}',
// plus in the project config:
snapshotDir: './e2e/screenshots',
```

Playwright's built-in `{platform}` token eliminates the need for manual platform suffix construction in test code. Screenshot names use descriptive identifiers only: `{ name: 'editor-loaded' }` – the template appends the platform automatically (e.g., `editor-loaded-darwin.png`).

Scripts:
- `npm run test:e2e:visual` = `electron-vite build && playwright test e2e/visual-regression.e2e.ts`
- `npm run test:e2e:update-screenshots` = `electron-vite build && playwright test e2e/visual-regression.e2e.ts --update-snapshots`

The update script is scoped to only the visual regression file to prevent unintended side effects on functional test screenshots.

**Baseline storage**: Baseline PNGs are committed to git. With 5 states x 1 platform = 5 files at ≤500KB each (≤2.5MB total), plain git is acceptable. `e2e/screenshots/` must NOT be in `.gitignore`. If the baseline count grows beyond 10MB or multiple platforms are actively maintained, migrate to Git LFS (`.gitattributes`: `e2e/screenshots/**/*.png filter=lfs diff=lfs merge=lfs -text`). Baseline updates must be reviewed as deliberate PR changes.

**019-FR-003: Rendering tolerance configuration**
Configure `maxDiffPixelRatio` at project level in `playwright.config.ts` to accommodate minor font rendering differences across environments. Default tolerance: 0.01 (1%). Individual assertions may override with tighter or looser thresholds where needed (e.g., Monaco editor text rendering may need 0.02).

Consider setting `retries: 0` for the visual regression test project in `playwright.config.ts` (via a separate project entry). A visual test that needs a retry indicates insufficient masking or tolerance – these should be diagnosed immediately rather than silently recovered. The global `retries: 1` remains for functional tests.

**019-FR-004: Video recording in CI**
Enable Playwright video recording when running in CI. Because Electron uses `_electron.launch()` (not browser contexts), `recordVideo` must be configured in the Electron launch options inside the test fixtures, not in `playwright.config.ts`'s `use` block. Configuration:

```ts
recordVideo: {
  dir: 'test-results/videos',
  size: { width: 1280, height: 720 }
}
```

Explicit size prevents Retina 2x captures from inflating file sizes. Gate on `process.env.CI`: off by default in local development. Record all tests (not just failures) to enable debugging of flaky tests.

Note: Electron video recording has known limitations – zero-length files on older Playwright versions, Windows-specific timeouts. Treat video as best-effort; traces and screenshots are the primary debugging artifacts.

**019-FR-005: Test artifact upload in CI**
Configure the GitHub Actions workflow (see FR-009) to upload artifacts in two groups: (a) `test-results/` (videos, traces, failure screenshots, HTML reports) with standard retention, (b) baseline diffs (if any) separately for easier review. Artifacts must be uploaded on both success and failure (`if: always()`).

**019-FR-006: Artifact retention policy**
Configure artifact retention in the GitHub Actions workflow (see FR-009) with branch-aware durations: 14 days for feature branch runs, 30 days for `develop` branch runs. Expression: `retention-days: ${{ github.ref == 'refs/heads/develop' && 30 || 14 }}`. This balances storage costs with debugging needs for production-affecting issues.

**019-FR-007: Visual regression test suite organization**
Create a dedicated E2E test file `e2e/visual-regression.e2e.ts` containing all visual comparison tests. This isolates visual tests from functional tests, allowing them to be run independently (`npm run test:e2e:visual`) or skipped when baselines need regeneration.

The five visual states should use a sequential single-session approach where practical: launch app -> capture empty state (a) -> open project -> capture loaded state (b) -> open terminal -> capture terminal state (c) -> open settings -> capture settings state (d) -> trigger dialog -> capture dialog state (e). This avoids 5 separate Electron launches and stays within the time budget. States (a) through (e) form a natural progression. If test isolation is needed for debugging, individual states can also be run independently with their own app instance.

**019-FR-008: Screenshot masking for dynamic content**
Configure screenshot masking and preparation for elements with dynamic or non-deterministic content:

1. **CSS animations**: Set `animations: 'disabled'` as project-level default in `expect.toHaveScreenshot` config. This pauses all CSS animations/transitions before capture.
2. **Monaco cursor**: Disable cursor blinking via `page.evaluate()` setting `editor.updateOptions({ cursorBlinking: 'solid' })` rather than masking the cursor region. This preserves visual information while eliminating non-determinism.
3. **Monaco minimap**: Mask the `.minimap` container – it renders a scaled view that varies with content and scroll position.
4. **Monaco scrollbars**: Mask scrollbar elements or ensure consistent scroll position (top of document) before capture.
5. **Terminal output**: Mask the entire terminal container (`[data-testid="terminal-instance"]` or `.xterm-rows` parent). xterm.js uses WebGL canvas rendering – Playwright's `mask` works on the DOM container element wrapping the canvas.
6. **Git status indicators**: Ensure the visual test project is created outside any git repository (use `os.tmpdir()` prefix) or initialized as a clean git repo with a known commit. This makes git status deterministically absent or in a known state.
7. **Timestamps**: Mask any elements displaying timestamps or relative times.
8. **Selection highlights**: Ensure no text is selected before capture (click a neutral area or call `editor.setSelection(new Range(1,1,1,1))`).

Use Playwright's `mask` option to cover masked regions with solid rectangles during comparison.

**019-FR-009: E2E CI workflow foundation**
Create a GitHub Actions workflow (`.github/workflows/e2e.yml`) that: (a) triggers on push to `develop` and on pull requests, (b) runs on `macos-latest` runner (Electron requires a display server), (c) installs dependencies and builds the app (`electron-vite build`), (d) runs Playwright E2E tests, (e) serves as the host for FR-005 artifact upload and FR-006 retention policy. This is a prerequisite for FR-005 and FR-006.

**019-FR-010: Deterministic window sizing**
Visual regression tests must set a fixed BrowserWindow size (1280x800) and force device scale factor to 1x before any screenshot capture. Implementation: add `--force-device-scale-factor=1` to Electron launch args in the visual test fixture, and call `page.setViewportSize({ width: 1280, height: 800 })` or use `electronApp.evaluate()` to resize the BrowserWindow. This ensures consistent screenshots regardless of the host display configuration (Retina vs standard, CI vs local).

### Non-functional requirements

**019-NFR-001: Visual test execution time**
The full visual regression suite must complete within 180 seconds on CI (macOS runner), including Electron app startup. Use `test.slow()` at the describe level to triple the default 60s timeout to 180s. The sequential single-session approach (FR-007) avoids multiple Electron launches, keeping execution within budget.

**019-NFR-002: Baseline screenshot size**
Individual baseline screenshots must not exceed 500KB each (PNG). Use the configured viewport size (1280x800 at 1x DPR per FR-010) and avoid full-resolution captures. Total baseline directory size must stay under 10MB.

**019-NFR-003: CI artifact size**
Total uploaded artifact size per run must not exceed 100MB. Video files are the primary contributor – the explicit `size: { width: 1280, height: 720 }` in FR-004 prevents Retina 2x captures from inflating file sizes. Monitor actual sizes after initial implementation.

---

## Acceptance criteria

**019-AC-001: Visual comparison passes**
Given baseline screenshots exist for all 5 core UI states, when running `npm run test:e2e:visual`, then all visual comparisons pass with the configured tolerance on the same platform.

**019-AC-002: Cross-platform baselines**
Given baseline screenshots for macOS, when running visual tests on a different platform (Linux CI), then tests check for baseline existence before each assertion. If the baseline file does not exist for the current platform, call `test.skip(true, 'No baseline for ${process.platform}')`. This requires a `beforeAll` or per-test guard using `fs.existsSync()` against the resolved snapshot path. CI should report skipped tests visibly (not silently) so missing baselines are noticed.

**019-AC-003: Video recording in CI**
Given E2E tests running in CI (`CI=true`), when a test fails, then a video recording of the test session exists in `test-results/videos/` and is included in the uploaded artifact.

**019-AC-004: Dynamic content masking**
Given the editor view with a blinking cursor, when taking a screenshot comparison, then the cursor blinking is disabled via editor options (not masked) and does not cause a false positive diff.

**019-AC-005: Artifact availability**
Given a completed CI E2E run, when clicking "Artifacts" in the GitHub Actions run page, then a downloadable archive containing screenshots, videos, and traces is available with the configured retention period.

---

## Implementation notes

- **HTML reporter**: Configure Playwright HTML reporter (`reporter: [['html', { open: 'never' }], ['list']]`) for self-contained CI debugging reports with embedded screenshots and diffs.
- **Future visual states**: Image preview panel, Mermaid fullscreen viewer, and split-view editor are candidates for future visual regression coverage.
- **Baseline drift detection**: Consider a CI step that runs `--update-snapshots` and fails if committed baselines differ from regenerated ones – detects stale baselines.
- **Architecture suffix**: If Apple Silicon vs Intel macOS produces different rendering, consider `{platform}-{arch}` baseline naming. Monitor after initial baselines are established.

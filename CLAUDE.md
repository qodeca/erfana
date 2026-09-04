# Erfana - Project Instructions for Claude

## Project Overview
An agent-native Markdown workspace (Electron): integrated terminal for CLI coding agents, Monaco editor + live preview, project tree. Erfana hosts the agent – it is not itself an AI model, so never overclaim built-in AI. The context-window meter is Claude Code-specific (it reads `~/.claude` transcripts); the terminal itself runs any CLI agent.
- **Repository**: `qodeca/erfana` (GitHub, public)
- **License**: `GPL-3.0-only`, copyright (c) 2025-2026 **Qodeca sp. z o.o.** ([LICENSE](LICENSE)). Per-file licensing follows the [REUSE](https://reuse.software) spec – SPDX headers on every source file plus [`REUSE.toml`](REUSE.toml). The "Erfana"/"Qodeca" names and logos remain Qodeca trademarks ([TRADEMARKS.md](TRADEMARKS.md)) – forks must rebrand. Contributions require the project CLA ([CLA.md](CLA.md)). `"private": true` in package.json is a publish guard for the desktop app, not a license statement.
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 24+ (development), Electron 39 bundles Node.js 22.22.1

## Branching model
- `main` — released code only. Protected (required status checks, `enforce_admins`, signed `v*.*.*` tags); direct push is the intended solo-dev workflow, no PR required.
- `develop` — the day-to-day integration branch, and the base for small features and bugfixes. Branch general work off `develop`, **not** `main` (main lags).
- `graph` — "develop for the graph engine": the integration branch for spec 004 and the [#21](https://github.com/qodeca/erfana/issues/21) contract chain (#22–#32) plus related functionality. Do **not** start graph-engine work from `develop`; branch off `graph` (`git checkout -b feature/<name> graph`) or the already-frozen R1 contracts will be re-implemented from scratch. Inventory of what is frozen there: [ROADMAP.md](ROADMAP.md) § Graph engine chain.
- Graph-engine work merges back into `graph`; `graph` merges into `develop` only when the engine is shippable. Merge `develop` **into** `graph` periodically to limit drift — never the reverse until the chain lands.
- Feature branches: `feature/<name>`, off whichever integration branch owns the work. Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).

## Documentation
Index and descriptions live in [docs/README.md](docs/README.md) — read that rather than a second copy here. Two pointers carry rules that are easy to skip past:

- **Before filing, editing or closing a GitHub issue**: [GitHub issues protocol](docs/claude-code/github-issues-protocol.md). The repo ships issue *forms*; `gh issue create` applies neither their title prefix nor their required fields, so both must be supplied by hand. Security vulnerabilities go to private advisory reporting, never a public issue.

- [Windows enablement](docs/windows/README.md) – cross-platform support (macOS + Windows). **Canonical phase roadmap + current status** lives in [`docs/windows/implementation-plan.md`](docs/windows/implementation-plan.md) – consult it rather than tracking phase state here. Sub-docs: [contributor workflow](docs/windows/contributing.md), [test-flake register](docs/windows/known-flakes.md), deferred work [D1–D8](docs/windows/deferred-work.md) / [D9–D12](docs/windows/deferred-work-phase4.md), [whisper binary build runbook](docs/build/whisper-binaries.md), [Windows-specific known issues](docs/known-issues.md#windows-specific-issues). **Refresh policy**: on any release that touches Windows-phase scope OR changes a phase issue's state, bump the "Status snapshot" date + version anchor in `docs/windows/implementation-plan.md` before tagging – that file is the single source of truth, so keep it current to avoid doc-vs-code drift.

## Feature specifications

**Registry**: `specs/registry.json` is the authoritative list — check it before implementing a new feature. It carries id, name, tier, status and path for every spec; `path` is relative to `specs/`, and a spec is active unless its status is `archived` (archived specs live under `specs/archived/`). Read the registry rather than keeping a second copy here.

**Before implementing a feature**: Read the spec overview (`requirements/01-overview.md`), requirements (`requirements/02-requirements.md`), and acceptance criteria (`requirements/03-acceptance.md` for T3 specs; `requirements/04-acceptance.md` for T4, where `03` is use-cases).

## Code Style & Conventions
- Component styling: plain co-located global CSS files imported by the component (e.g. `import './Dialog.css'`); `*.module.css` is the rare exception (currently only `Panels/ImageViewerPanel/ImageViewerPanel.module.css`)
- Panel ids and panel opening: never hand-build an `editor-…` / `image-…` / `preview-…` id. An id past `PANEL_ID_PATH_BUDGET` (180 sanitized chars) is shortened to a 150-char head plus a 16-hex digest, so never read a path back out of an id. Use `getFilePanelId()` / `openFileInPanel()` from `src/renderer/src/utils/openFileInPanel.ts`, so the id prefix, `component` and `tabComponent` are all derived from one `isImageFile` call and cannot disagree. An ESLint `no-restricted-syntax` selector (in the same `src/renderer/**` block as the Windows-path rules) enforces it (#70)
- Renderer platform detection: use `isMacOS()` / `isWindows()` from `src/renderer/src/utils/platform.ts` (backed by the sync `window.api.utils.getPlatform()` bridge). Never read `navigator.platform` or `process.platform` in the renderer — `process.platform` is `undefined` under the sandbox
- Renderer path handling: derive basenames, dirnames, and display relative paths via the cross-platform helpers in `src/renderer/src/utils/fileUtils.ts` (`getBasename`, `getDirname`, `stablePathDigest`, `getDisplayRelativePath`, `isPathInside`, `isStrictDescendant`) — never `filePath.split('/')`, `lastIndexOf('/')`, or POSIX-only path math, because the main process passes **native** separators across IPC (paths can contain `\` on Windows). The ESLint `no-restricted-syntax` rule over `src/renderer/**` catches only **two path shapes** – `.split('/').pop()` and `x.endsWith('/') ? x : x + '/'` – and exempts three files - `utils/fileUtils.ts`, `utils/openFileInPanel.ts` and `services/preview/OverlayGuardService.ts` (the third for a preview-visibility selector, not a path one). Every other POSIX-only form (`lastIndexOf('/')`, a bare `.split('/')`, manual joins) is convention only and passes lint, so review for it by hand. These helpers are display/parse-only — they are **not** for filesystem confinement; real confinement stays main-side in `ExternalFileService` via `realpath`
- User-input PII in logs: redact user-supplied values (e.g. filenames) before `logger.error` via `redactUserInput(message, code)` (`src/main/utils/redactUserInput.ts`); the user-facing toast keeps the full value, log files get `[redacted-filename]`
- Error containment (two tiers): a new panel wraps its content in `<PanelErrorBoundary componentName="…">` **keyed by whatever scopes that content** (e.g. `key={projectPath ?? 'none'}`, see `src/renderer/src/components/Panels/ProjectPanel.tsx`), so a defect degrades that panel instead of the window – without the key a panel that failed on project A still reads "unavailable" after switching to project B. `RootErrorBoundary`, `installGlobalErrorTrail()` and the main-process crash handlers are the outer layers: [docs/ui-components.md § Error containment](docs/ui-components.md#error-containment)

## Design system (MANDATORY)

**Before implementing ANY UI changes**: open [`design/index.html`](design/index.html) in a browser. It is the design system — plain HTML cards that each **decide** one rule and render it live, loading a synced copy of the app's real `src/renderer/src/styles/design-tokens.css` and its real bundled font. A card shows every state rather than describing it, which is how its defects get found.

Read the card for what you are changing. A card marked `status="decided"` is binding; `status="proposed"` means it is still a sketch — use it as the direction of travel, not as settled law.

**Key rules**: Use `var(--color-*)`, `var(--space-*)`, `var(--text-*)` tokens. No hardcoded values. `border-radius: 0` always. `npm run lint:css` in the required `Lint` job enforces **four** of these mechanically — no hex colours, no bare `z-index`, `border-radius` from the token only, and the `erf-` class namespace on design-system component CSS. **Spacing and typography tokens are convention, not enforcement**: `padding: 11px` and `font-size: 13px` both pass lint, so review for them by hand.

**Numbers in a card are generated**, never typed: they come from `design/claims.json` via a runnable predicate over `src/`, and `scripts/design-claims.test.mjs` re-derives every one on each CI run. Do not hand-edit a number into a card — add a ledger entry.

**Deviating is allowed if the code says so at the site**: `/* deviates: design/<card> — why */`, plus a row in that card's Exceptions section. An undocumented deviation is a bug.

[docs/ui-style-guide.md](docs/ui-style-guide.md) still holds the text-selection policy and the dark-only stance; its visual sections are stubs pointing at the cards. Do not put a new visual rule there.

**Naming, because it is confusable**: `design/` (repo root) is the design system. `docs/design/` and `docs/designs/` are per-issue design notes and are unrelated.

## Testing
- E2E: Playwright with Electron, Page Object Model pattern — POM classes, composed fixtures, and the shared locator/wait helpers are catalogued in [docs/testing/e2e-testing.md](docs/testing/e2e-testing.md)
  - **Convention**: condition-based waits only in new tests – never `waitForTimeout` (nine legacy uses remain, in `visual-regression.e2e.ts` and the terminal page object). Use the POM waits (`waitForPrompt()`, `waitForOutput()`), `waitForIpcComplete`, or Playwright auto-waiting
- Windows-host flakes: catalogued in [`docs/windows/known-flakes.md`](docs/windows/known-flakes.md) with status legend + remediation-patterns cheat-sheet. `npm run test:cov` cannot pass on a Windows host – two per-file floors miss because their symlink cases skip on win32, so CI runs coverage on Linux. Test-file split policy in [`docs/windows/contributing.md`](docs/windows/contributing.md) §"Test-file split policy" — split when mocks hoist to module scope (reference: `FileService.copyItem.limit.test.ts`, `WhisperModelManager.downgrade.test.ts`); keep in-file for per-describe `vi.useFakeTimers` (reference: `SettingsOverlay.test.tsx` Focus management)

## Continuous Integration
See [docs/ci.md](docs/ci.md) for the full pipeline map — workflow table, per-job breakdown, `npm ci` retry and concurrency-cancellation patterns. The parts that are **not** derivable from `.github/workflows/`:
- **Required checks** (branch protection lives GitHub-side, not in the repo, and matches **check names**, not job ids): `Lint`, `Typecheck`, `Unit tests`, `Build`, `Coverage`, `License compliance` (all from `checks.yml`) plus `Secret scan`. `Windows checks` is advisory; `e2e` is intentionally excluded until stable.
- **`e2e.yml`** (`.github/workflows/e2e.yml`) — **disabled**: both functional `electron` and `visual` suites run locally only until macos-latest instability is root-caused. Re-enable with `gh workflow enable "E2E Tests"`. E2E is excluded from branch-protection required checks, so disabling blocks no merges.
- **`secret-scan.yml`** — runs on **every push + PR**: gitleaks (full git history) + trufflehog (verified secrets), with version-pinned, SHA-256-checksum-verified binary downloads and no third-party actions. Its `Secret scan` job is a branch-protection required check. gitleaks runs with `--log-opts="--all"`, so it scans **every ref in the repo, not just the current branch** — a finding on another branch fails this one, and `.gitleaksignore` must therefore carry the fingerprint on every branch, even where the offending file is absent (see [docs/ci.md](docs/ci.md#secret-scan-secret-scanyml)).
- **Workflow display names** use Title Case in the Actions UI (e.g. `Quality Checks`, `Whisper Binaries (Canary)`). This is a project-specific convention that overrides the global Sentence-case style rule for `name:` fields only — see [`.github/workflows/`](.github/workflows/) for the canonical list. Filenames stay lowercase/kebab-case.
- **Before pushing**, run the local equivalents (`npm run lint && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:ci && npx electron-vite build`) to catch issues without CI minutes. `lint:css` and the design-sync check are **steps inside the required `Lint` job** (the design-sync check runs again in the advisory `Windows checks` job, to catch a CRLF regression - #104), not separate jobs — branch protection matches the job name, so a new job would enforce nothing. Run `npm run test:e2e` locally before merging anything that touches Electron-specific paths since CI no longer covers it.

## Project Switching Safeguards
Behaviour is readable from the code; the one non-obvious guard is:
- Autosave must never lose keystrokes: a save in flight, its own echo event, and local edits made during the save are each guarded separately in `useFileWatcher`, and `MarkdownEditorPanel` re-checks the Monaco buffer after every write (#124). See [docs/file-watching/README.md](docs/file-watching/README.md)

## IPC Contracts

The full channel index is [docs/ipc-patterns.md](docs/ipc-patterns.md) § Current IPC Channels; payload shapes live in `src/shared/ipc/*-schema.ts`, and name constants for the newer domains in `*-channels.ts` (older domains still declare channel strings inline in `src/main/ipc/*-handlers.ts`). Read those rather than duplicating them here. The invariants that are **not** visible from the schemas:

- **Terminal creation** – `TerminalService.createTerminal` returns `{ terminalId, shellKind }` or `{ error }`, never `null`, and the handler passes that `error` through to the renderer verbatim. There is no `terminal-schema.ts`, so this contract is invisible from `src/shared/ipc/`.
- **Clipboard** – backed by Electron's main-process `clipboard` module, never `navigator.clipboard`, so the sandbox stays on. `src/main/ipc/clipboard-handlers.ts` validates the sender frame (`event.senderFrame`, top-level + dev/`file://` origin only). The renderer `textClipboard` singleton (`src/renderer/src/services/textClipboard.ts`) is the **single** transport-error chokepoint (retry-once + debounced toast) — don't call the bridge directly.
- **Claude Code status** – register carries `terminalId` only; the PTY pid is resolved main-side and is **never** trusted from the renderer.
- **Image export** (`image-export:run`) – the renderer sends `{ filePath, target }` and no image bytes ever travel back to it: the main process re-reads the file from disk, rasterizes it in a hidden hardened window, then writes the file or the clipboard itself. The handler is **sender-gated** (`isTrustedSender`) before the payload is parsed, unlike the older `pdf:` / `docx:` handlers — see [docs/technical-debt.md](docs/technical-debt.md). The three `image-export:harness-*` channels are frame-scoped to that hidden window and never registered on global `ipcMain`, so they are absent from the channel index (#73).
- **System actions** (`system:*`) – payload-free and sender-gated; `system:relaunchApp` must quit gracefully, and the paired `screenshot:getScreenPermission` read is advisory and never gates a capture. Rationale for both in [docs/api-services.md § System actions](docs/api-services.md#system-actions-apisystem).

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12; 3.14.3 also verified) — this one is worth keeping here because it fails at install time, before any doc gets read

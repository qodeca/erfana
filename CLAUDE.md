# Erfana - Project Instructions for Claude

## Project Overview
An agent-native Markdown workspace (Electron) that runs terminal coding agents like Claude Code beside the editor — integrated terminal with a live Claude Code context-window meter, Monaco editor + live preview, and a project tree. Positioning: an "agent-native Markdown workspace," agent-agnostic with Claude Code as the lead example; Erfana hosts/companions the agent (it is not itself an AI model — never overclaim built-in AI). Note: the context-window meter is Claude Code-specific (reads `~/.claude` transcripts); the terminal itself runs any CLI agent.
- **Repository**: `qodeca/erfana` (GitHub, public)
- **Version**: 0.16.3
- **License**: `GPL-3.0-only` (open source). Copyright (c) 2025-2026 **Qodeca sp. z o.o.** See [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT) (relicensing record). Per-file licensing follows the [REUSE](https://reuse.software) spec (SPDX headers + `REUSE.toml`); third-party notices are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). The code is GPL; the "Erfana"/"Qodeca" names and logos remain Qodeca trademarks (see [TRADEMARKS.md](TRADEMARKS.md)) — forks must rebrand. Contributions require the project CLA (see [CLA.md](CLA.md)), which preserves Qodeca's dual-licensing option. `"private": true` in package.json is a publish guard for the desktop app, not a license statement.
- **Tech Stack**: Electron 39, React 18, TypeScript 6.0, Monaco Editor, xterm.js
- **Build Toolchain**: electron-vite 5, Vite 6, vitest 3
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 24+ (development), Electron 39 bundles Node.js 22.20.0

## Branching model
- `main` — released code only. Protected (required status checks, `enforce_admins`, signed `v*.*.*` tags); direct push is the intended solo-dev workflow, no PR required.
- `develop` — the day-to-day integration branch, and the base for small features and bugfixes. Branch general work off `develop`, **not** `main` (main lags).
- `graph` — "develop for the graph engine": the integration branch for spec 004 and the [#21](https://github.com/qodeca/erfana/issues/21) contract chain (#22–#32) plus related functionality. **The R1 contract freeze already landed there** — schemas, STRICT DDL, `IGraph*` interfaces, `GRAPH_*`/`MCP_*` error codes and the `specs/designs/sd-021-*` design set all live on `graph` and are deliberately absent from `develop`. Do **not** start graph-engine work from `develop`; branch off `graph` (`git checkout -b feature/<name> graph`) or the frozen contracts will be re-implemented from scratch.
- Graph-engine work merges back into `graph`; `graph` merges into `develop` only when the engine is shippable. Merge `develop` **into** `graph` periodically to limit drift — never the reverse until the chain lands.
- Feature branches: `feature/<name>`, off whichever integration branch owns the work. Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).

## Main-process services

Directory layout is derivable (`ls`, plus [docs/architecture.md](docs/architecture.md)). This one catalogue is not — it is the index of what exists under `src/main/services/`:

- Core: FileService, TerminalService, ProjectService, LoggingService; Git: GitStatusService, GitWatcherService, GitPollingService, GitStatusWorkerAdapter, GitStatusCircuitBreaker; Watchers: DirectoryWatcherService, FileWatcherService; Settings: SettingsService, ProjectSettingsService, GlobalSettingsService; Media: ScreenshotService (dispatcher → screenshot/ subdir with MacScreenshotCapturer + DesktopCapturerScreenshotCapturer + ScreenshotOverlayWindow [#164]), CameraService, DocxService, TranscriptionService, LocalWhisperService, WhisperModelManager, whisper-assets (pinned release + classifyPlatform), whisper-pubkeys (dual minisign keys), AudioMetadataService, AudioExtractionService, ApiKeyService; Import: LiteParseConverter, DependencyDetector; Claude status: claudeStatus/ (ClaudeStatusService orchestrator, ClaudeTranscriptWatcher [refcounted chokidar on ~/.claude/projects], ClaudeTranscriptParser, ClaudeTranscriptLocator, ClaudeWindowDetector [model-capability registry 200k/1M], friendlyModelName, encodeCwd [platform-branched: macOS `/`+`.`→`-`, Windows `/`+`\`+`:`+`.`→`-`], process/{MacClaudeProcessDetector, WinClaudeProcessDetector [#217], exec (shared ExecLike), createProcessDetector}); Multi-instance: ProjectLockService, ExternalFileService; Subdirs: import/, watcher/, workers/, screenshot/, claudeStatus/

## Core features

The full catalogue of shipped features (editor, project tree, terminal, prompt
templates, export, import, transcription, Claude Code status bar, and more) lives
in [docs/features/README.md](docs/features/README.md).

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Build](docs/build/README.md) — Build configuration, electron-builder, ASAR, fuses, troubleshooting, whisper-binaries CI ops runbook (self-hosted Phase 4 release flow)
- [Release pipeline](docs/build/release.md) — Multi-platform release workflow (`.github/workflows/release.yml`: prepare → {build_mac, build_win} → finalize → cleanup; Linux distribution target dropped — macOS + Windows only), secrets + rotation calendar, minisign verification, incident response (B.1 federated-cred cleanup, B.2 cert workstation-loss DR, B.3 PFX hygiene). Windows signs via Azure Artifact Signing **certificate auth** (X.509 against app registration — electron-builder 26 doesn't support OIDC). Skill entry: [`.claude/skills/releasing-erfana/SKILL.md`](.claude/skills/releasing-erfana/SKILL.md) with [`guides/troubleshooting.md`](.claude/skills/releasing-erfana/guides/troubleshooting.md) (typed-regex CI failure cookbook) + [`docs/release-incidents/`](docs/release-incidents/) (auto-appended incident memos). Branch protection on `main` + a protected `v*.*.*` tag ruleset are live (required status checks + `enforce_admins` + signed-tag rule); **direct push is the solo-dev workflow** (no PR requirement) — the release skill verifies this at Phase 0.4.5 and aborts if a PR rule is reinstated. `e2e` is intentionally excluded from required checks until stable.
- [Security](docs/security.md) — Electron 39 security hardening, fuses, sandboxing, trade-offs
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, scroll fixes, clipboard, file links (CLI-wrap joining, @-prefix, :line-line range), drag-drop paths, cross-platform screenshot capture (macOS native + Windows/Linux desktopCapturer, [#164](https://github.com/qodeca/erfana/issues/164)), camera capture (cross-platform)
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync, Mermaid diagrams
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens, PauseController auto-resume
- [Logging](docs/logging.md) — Logging layer, log levels, file rotation, configuration
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, E2E (POM), visual regression, coverage
- [Continuous Integration](docs/ci.md) — GitHub Actions workflows (`checks.yml` + `secret-scan.yml` active; `e2e.yml` **disabled** — local-only until macos-latest fix; `release.yml` + `whisper-binaries*.yml` for release flow), required-checks set, retry patterns, visual-on-CI gap
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [API Services](docs/api-services.md) — Service APIs (Terminal, File, Settings, Watchers)
- [API Services – Features](docs/api-services-features.md) — Feature service APIs (GitStatus worker architecture, GitWatcher, GitPolling, GitStatusWorkerAdapter, GitStatusCircuitBreaker, Camera, ProjectLock, ExternalFile, LiteParse, DependencyDetector, DOCX, Transcription, LocalWhisper, WhisperModelManager, AudioMetadata, AudioExtraction, ApiKey)
- [Error Codes](docs/error-codes.md) — Project-wide `ErrorCode` enum index (~100 codes grouped by category; operator actions for whisper + transcription codes)
- [ADRs](docs/adrs/README.md) — Architecture Decision Records. Current: 0001 self-host whisper binaries, 0002 minisign over cosign/Sigstore, 0003 dual-pubkey trust, 0004 per-spawn TOCTOU re-hash
- [Whisper Trust Chain](docs/windows/whisper-trust-chain.md) — 4-layer client-side trust model with composition diagram + attacker model
- [Whisper Support Runbook](docs/windows/whisper-support-runbook.md) — Operator playbook for `WHISPER_*` error codes with diagnostic trails + stuck-user procedures
- [UI Components](docs/ui-components.md) — React component architecture, activity bars, panels
- [Prompt Templates](docs/prompts/README.md) — AI prompt system, AutoExecute, template syntax
- [Settings](docs/settings.md) — Settings overlay sections (Editor, Git, Logging, Transcription)
- [Changelog](docs/CHANGELOG.md) — Version history (v0.6.0 onwards; earlier in [archive](docs/archive/changelog-v03-v05.md))
- [Development Tasks](docs/development-tasks.md) — How-to guides: add IPC channels, panels, services, import converters, prompt templates
- [Technical Debt](docs/technical-debt.md) — Known debt items and improvement opportunities
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI
- [Large-Project Performance](docs/large-project-performance-plan.md) — Implementation plan for #146–#151 (EMFILE, worker thread, diagnostics)
- [Windows enablement](docs/windows/README.md) — cross-platform support (macOS + Windows). **Canonical phase roadmap + current status** lives in [`docs/windows/implementation-plan.md`](docs/windows/implementation-plan.md) — consult it rather than tracking phase state here. Sub-docs: [contributor workflow](docs/windows/contributing.md), [test-flake register](docs/windows/known-flakes.md) (symptom → status → remediation pattern), deferred work [D1–D8](docs/windows/deferred-work.md) / [D9–D12](docs/windows/deferred-work-phase4.md), [whisper binary build runbook](docs/build/whisper-binaries.md), [Windows-specific known issues](docs/known-issues.md#windows-specific-issues). **Refresh policy**: on any release that touches Windows-phase scope OR changes a phase issue's state, bump the "Status snapshot" date + version anchor in `docs/windows/implementation-plan.md` before tagging — that file is the single source of truth, so keep it current to avoid doc-vs-code drift.
- [Source Grounding](docs/future/source-grounding/README.md) — NotebookLM-style grounding research, gap analysis, strategy, implementation roadmap
- [Roadmap](ROADMAP.md) — Implementation order for active specs with dependency analysis

## Feature specifications

Feature specifications live in `specs/`. Check registry before implementing new features.

### Active specs

| ID | Name | Tier | Status | Path |
|----|------|------|--------|------|
| 004 | Graph engine foundation | T4 | draft | `specs/spec-t4-004-graph-foundation` |
| 005 | Vector search & hybrid retrieval | T3 | draft | `specs/spec-t3-005-vector-search` |
| 006 | Knowledge graph & entities | T3 | draft | `specs/spec-t3-006-knowledge-graph` |
| 007 | Temporal queries & timeline | T3 | draft | `specs/spec-t3-007-temporal-queries` |
| 008 | Graph engine polish & maintenance | T3 | draft | `specs/spec-t3-008-graph-polish` |
| 009 | Media import with transcription | T4 | archived | `specs/archived/spec-t4-009-media-import-transcription` |
| 013 | Multi-CLI tool prompt optimization | T3 | draft | `specs/spec-t3-013-multi-cli-tool-prompt-optimization` |
| 016 | Project Tree refresh specification | T3 | archived | `specs/archived/spec-t3-016-project-tree-refresh` |
| 017 | Test ID coverage and accessibility selectors | T2 | archived | `specs/archived/spec-t2-017-test-id-accessibility` |
| 018 | E2E infrastructure overhaul | T3 | archived | `specs/archived/spec-t3-018-e2e-infrastructure` |
| 019 | Visual regression and CI resilience | T2 | archived | `specs/archived/spec-t2-019-visual-regression-ci` |
| 020 | Google Drive link integration | T4 | draft | `specs/spec-t4-020-google-drive-links` |
| 021 | LiteParse document import | T3 | archived | `specs/archived/spec-t3-021-liteparse-document-import` |
| 022 | Git status thread offloading | T3 | archived | `specs/archived/spec-t3-022-git-status-offload` |

**Registry**: `specs/registry.json`

**Before implementing a feature**: Read the spec overview (`requirements/01-overview.md`), requirements (`requirements/02-requirements.md`), and acceptance criteria (`requirements/03-acceptance.md`).

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons
- Renderer platform detection: use `isMacOS()` / `isWindows()` from `src/renderer/src/utils/platform.ts` (backed by the sync `window.api.utils.getPlatform()` bridge). Never read `navigator.platform` or `process.platform` in the renderer — `process.platform` is `undefined` under the sandbox
- Renderer path handling: derive basenames, dirnames, and display relative paths via the cross-platform helpers in `src/renderer/src/utils/fileUtils.ts` (`getBasename`, `getDirname`, `getDisplayRelativePath`, `isPathInside`, `isStrictDescendant`) — never `filePath.split('/')`, `lastIndexOf('/')`, or POSIX-only path math, because the main process passes **native** separators across IPC (paths can contain `\` on Windows). An ESLint `no-restricted-syntax` rule (`src/renderer/**`, `fileUtils.ts` exempt) enforces this. These helpers are display/parse-only — they are **not** for filesystem confinement; real confinement stays main-side in `ExternalFileService` via `realpath`
- User-input PII in logs: redact user-supplied values (e.g. filenames) before `logger.error` via `redactUserInput(message, code)` (`src/main/utils/redactUserInput.ts`); the user-facing toast keeps the full value, log files get `[redacted-filename]`

## UI Style Guide (MANDATORY)

**Before implementing ANY UI changes**: Read [docs/ui-style-guide.md](docs/ui-style-guide.md) and use design tokens from `src/renderer/src/styles/design-tokens.css`.

**Key rules**: Use `var(--color-*)`, `var(--space-*)`, `var(--text-*)` tokens. No hardcoded values. `border-radius: 0` always.

## Changelog

For detailed changelog, see [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Nested CLAUDE.md (component-specific patterns)
- [`src/renderer/src/components/Dialog/CLAUDE.md`](src/renderer/src/components/Dialog/CLAUDE.md) - BaseDialog API, focus trap, ESC/backdrop handling
- [`src/renderer/src/components/Transcription/CLAUDE.md`](src/renderer/src/components/Transcription/CLAUDE.md) - Dual-backend transcription (OpenAI + local whisper.cpp), IPC flow, store

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see [docs/testing/README.md](docs/testing/README.md))
- E2E: Playwright with Electron, Page Object Model pattern (see [docs/testing/e2e-testing.md](docs/testing/e2e-testing.md))
  - POM classes in `e2e/pages/`: TerminalPage, MonacoPage, MermaidPage, ProjectTreePage, KeyboardHelper
  - Composed fixtures in `e2e/fixtures/index.ts` – use `test` export with POM fixtures (worker-scoped userDataDir, test-scoped app/window)
  - Project fixtures: `testProject` (isolated temp dir with seed files), `withSettings` (writes `.erfana/settings.json`), `withOpenFile` (opens file in editor, waits for Monaco readiness)
  - App-with-project fixtures: `appWithTestProject` / `windowWithTestProject` – launch Electron with testProject path
  - Backward-compatible adapter in `e2e/utils/helpers.ts` (WeakMap caching delegates to POM instances)
  - Condition-based waits preferred over `waitForTimeout` – use `waitForPrompt()`, `waitForOutput()`, Playwright auto-waiting
  - Wait helpers in `e2e/utils/wait-helpers.ts`: `waitForIpcComplete` (race-safe IPC wait helper)
  - Shared locators in `e2e/utils/locators.ts`: `byTestId`, `byDynamicTestId`, `waitForTestId`, `waitForTestIdHidden`
- Visual regression: Playwright `toHaveScreenshot()` for 5 UI states (welcome, editor, terminal, settings, confirm dialog); baselines in `e2e/screenshots/` with platform suffix; `--project=visual` in Playwright config; **runs locally only** – `macos-latest` CI hangs at `waitForLoadState('domcontentloaded')` ([docs/ci.md § Visual regression on CI](docs/ci.md#visual-regression-on-ci))
- E2E env vars: Some tests require API keys via `.env` file (see `.env.example`); tests skip gracefully if not set
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`)
- Windows-host flakes: catalogued in [`docs/windows/known-flakes.md`](docs/windows/known-flakes.md) with status legend + remediation-patterns cheat-sheet. Test-file split policy in [`docs/windows/contributing.md`](docs/windows/contributing.md) §"Test-file split policy" — split when mocks hoist to module scope (reference: `FileService.copyItem.limit.test.ts`, `WhisperModelManager.downgrade.test.ts`); keep in-file for per-describe `vi.useFakeTimers` (reference: `SettingsOverlay.test.tsx` Focus management)

## Continuous Integration
See [docs/ci.md](docs/ci.md) for the full pipeline map. Summary:
- **`checks.yml`** (`.github/workflows/checks.yml`) — runs on **every push to any branch**. Eight parallel jobs on `ubuntu-latest` (except `windows-checks`): the four core required checks `lint` / `typecheck` / `test` (full vitest workspace — main/renderer/preload) / `build` (`electron-vite build`); `license` (`check:headers` + `reuse lint`, also a required check); `audit-signatures` (`npm audit signatures` + records the `package-lock.json` digest artifact `release.yml` verifies); `release-guards` (fails on `pull_request_target`, forbidden plist entitlements, etc.); and an advisory `windows-checks` job on `windows-latest` (typecheck + `test:main`; `shell: bash`; not required until proven stable). ~3 min wall-clock. See [docs/ci.md](docs/ci.md) for the full job table + required-checks set.
- **`e2e.yml`** (`.github/workflows/e2e.yml`) — **disabled**: both functional `electron` and `visual` suites run locally only until macos-latest instability is root-caused. Re-enable with `gh workflow enable "E2E Tests"`. E2E is excluded from branch-protection required checks, so disabling blocks no merges.
- **`release.yml`** — fires on `v*.*.*` tag push, calls `build_mac.yml` / `build_win.yml` reusables (multi-platform build — macOS + Windows; Linux distribution target dropped). See [docs/build/release.md](docs/build/release.md).
- **`whisper-binaries.yml` + `whisper-binaries-canary.yml`** — `workflow_dispatch` only and monthly schedule respectively. See [docs/build/whisper-binaries.md](docs/build/whisper-binaries.md).
- **`secret-scan.yml`** — runs on **every push + PR**: gitleaks (full git history) + trufflehog (verified secrets), with version-pinned, SHA-256-checksum-verified binary downloads and no third-party actions. Its `Secret scan` job is a branch-protection required check. gitleaks runs with `--log-opts="--all"`, so it scans **every ref in the repo, not just the current branch** — a finding on another branch fails this one, and `.gitleaksignore` must therefore carry the fingerprint on every branch, even where the offending file is absent (see [docs/ci.md](docs/ci.md#secret-scan-secret-scanyml)).
- **Every `npm ci` is wrapped in retry**: `npm ci || (sleep 10 && npm ci) || (sleep 20 && npm ci)` – handles transient ECONNRESET on GitHub runners.
- **Concurrency cancellation** via `github.ref` — rapid pushes cancel in-flight runs on the same branch.
- **Workflow display names** use Title Case in the Actions UI (e.g. `Quality Checks`, `Whisper Binaries (Canary)`). This is a project-specific convention that overrides the global Sentence-case style rule for `name:` fields only — see [`.github/workflows/`](.github/workflows/) for the canonical list. Filenames stay lowercase/kebab-case.
- **Before pushing**, run the local equivalents (`npm run lint && npm run typecheck && npm run test:ci && npx electron-vite build`) to catch issues without CI minutes. Run `npm run test:e2e` locally before merging anything that touches Electron-specific paths since CI no longer covers it.

## Project Switching Safeguards
- Unsaved editor prompt on open/close (Discard/Cancel)
- Terminal activity heuristic:
  - Per-terminal tracking, marks on input + output
  - 500ms warm-up ignore
  - 20s busy window
  - Clears on exit and after Ctrl+C if quiet
- Terminal initialization defers until panel is visible
- Watchers increment session tokens on switch; stale events dropped
- Project settings loaded and validated before project opens (invalid settings block load)
- Autosave race condition prevention – three-layer defense in useFileWatcher: isSavingRef guard, content comparison (isEchoEvent with CRLF normalization), hasLocalChangesRef; post-save dirty re-detection in MarkdownEditorPanel checks Monaco buffer divergence (#124)

## IPC Contracts
- Shared schemas/types: `src/shared/ipc/*.ts` (zod schemas)
- `project:changed` payload: `{ oldPath: string | null; newPath: string | null }`
- Clipboard channels (`src/shared/ipc/clipboard-channels.ts`, `clipboard-schema.ts`) – async `ipcMain.handle`/`ipcRenderer.invoke`, backed by Electron's main-process `clipboard` module (sandbox stays on; no `navigator.clipboard`). Handler `src/main/ipc/clipboard-handlers.ts` validates the sender frame (`event.senderFrame`, top-level + dev/`file://` origin only):
  - `clipboard:readText` – Read plain text → `Promise<string>` (`''` on failure/untrusted)
  - `clipboard:writeText` – Write plain text (Zod-validated `z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)`, 5 MB) → `Promise<boolean>`
  - Preload bridge `api.clipboard` (`ClipboardBridge` type); renderer `textClipboard` singleton (`src/renderer/src/services/textClipboard.ts`) is the single transport-error chokepoint (retry-once + debounced toast)
- Document import channels (`src/shared/ipc/import-channels.ts`, `import-schema.ts`):
  - `import:document` – Start document import with options and progress streaming
  - `import:documentProgress` – Progress events (main → renderer push)
  - `import:documentCancel` – Cancel active import
  - `import:getDocumentExtensions` – Query available document extensions
  - `import:dependenciesReady` – Dependency detection complete (main → renderer push)
- Claude Code status channels (`src/shared/ipc/claude-status-channels.ts`, `claude-status-schema.ts`) – per-terminal Claude Code context status bar (macOS + Windows). Register carries `terminalId` only; the PTY pid is resolved main-side (never trusted from the renderer):
  - `claude-status:register` – Register a terminal panel for status tracking (invoke)
  - `claude-status:unregister` – Stop tracking a panel (invoke; on PTY exit / panel unmount)
  - `claude-status:nudge` – Request an immediate refresh for a panel (invoke)
  - `claude-status:changed` – Snapshot update for a `terminalId` (main → renderer push)
- System channels (`src/shared/ipc/system-channels.ts`) – payload-free OS-integration actions behind the macOS Screen Recording grant-and-relaunch flow. Both handlers are sender-gated main-side in `src/main/ipc/system-handlers.ts`:
  - `system:openScreenRecordingSettings` – Open the macOS Screen Recording privacy pane (invoke)
  - `system:relaunchApp` – Restart Erfana; macOS applies a fresh Screen Recording grant only to a newly-launched process (invoke)

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status runs in a worker thread via `worker_threads` (isomorphic-git default, native `git status --porcelain` fallback for large repos); global `.gitignore` not supported by isomorphic-git

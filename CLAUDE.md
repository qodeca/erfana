# Erfana - Project Instructions for Claude

## Project Overview
An agent-native Markdown workspace (Electron) that runs terminal coding agents like Claude Code beside the editor — integrated terminal with a live Claude Code context-window meter, Monaco editor + live preview, and a project tree. Positioning: an "agent-native Markdown workspace," agent-agnostic with Claude Code as the lead example; Erfana hosts/companions the agent (it is not itself an AI model — never overclaim built-in AI). Note: the context-window meter is Claude Code-specific (reads `~/.claude` transcripts); the terminal itself runs any CLI agent.
- **Repository**: `qodeca/erfana` (GitHub, public)
- **License**: `GPL-3.0-only` (open source). Copyright (c) 2025-2026 **Qodeca sp. z o.o.** See [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT) (relicensing record). Per-file licensing follows the [REUSE](https://reuse.software) spec (SPDX headers + `REUSE.toml`); third-party notices are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). The code is GPL; the "Erfana"/"Qodeca" names and logos remain Qodeca trademarks (see [TRADEMARKS.md](TRADEMARKS.md)) — forks must rebrand. Contributions require the project CLA (see [CLA.md](CLA.md)), which preserves Qodeca's dual-licensing option. `"private": true` in package.json is a publish guard for the desktop app, not a license statement.
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 24+ (development), Electron 39 bundles Node.js 22.20.0 (not expressed in `package.json` `engines`)

## Branching model
- `main` — released code only. Protected (required status checks, `enforce_admins`, signed `v*.*.*` tags); direct push is the intended solo-dev workflow, no PR required.
- `develop` — the day-to-day integration branch. Branch general feature/fix work off `develop`, **not** `main` (main lags and lacks current specs).
- `graph` — "develop for the graph engine": the integration branch for spec #004 and the [#21](https://github.com/qodeca/erfana/issues/21) contract chain (#22–#32) plus related functionality. Graph-engine work branches off `graph` and merges back into `graph`; `graph` merges into `develop` only when the engine is shippable. Merge `develop` **into** `graph` periodically to limit drift — never the reverse until the chain lands.
- Feature branches: `feature/<name>`, off whichever integration branch owns the work. Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).

### Merge-back hazards (`graph` → `develop`)

`graph` forked before `develop` was rewound to 2026-07-14, so the two branches' CI config has diverged in ways a merge would carry silently. Check each before merging back:

- **`.github/workflows/claude-code-review.yml` is deleted here** (commit `ec849e8`, "ci: disable Claude Code Review workflow") and still present on `develop` and `main`. Merging `graph` as-is **removes automated Claude review repo-wide**. Confirm that is intended, or restore the file in the merge — do not let the deletion ride along unnoticed.
- **`checks.yml` here has an extra hard gate `develop` lacks**: the `build` job runs `node scripts/smoke/sqlite-worker-smoke.mjs` (Node-ABI cross-check) with no `continue-on-error`, and that script exists only on this branch. Merging brings both; dropping the script without the step, or vice versa, breaks the Build check.
- **Action pins differ**: `graph` is on `actions/checkout` v7.0.1 and a newer `claude-code-action`; `develop` is on v6.0.3 with the older action, because the rewind dropped the Dependabot bumps. Reconcile deliberately rather than accepting whichever side the merge picks.
- **Dependabot never targets `graph`** (`.github/dependabot.yml` pins `target-branch: develop`, and Dependabot reads that config from the default branch). This branch gets no dependency maintenance of its own — pick it up by merging `develop` in.

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
- [Error Codes](docs/error-codes.md) — Project-wide `ErrorCode` enum index (~130 codes grouped by category; operator actions for whisper + transcription codes; the 26-code Graph engine block is contract-only until #23–#32 raise them)
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
- [Graph engine R1 design set (SD-021)](specs/designs/sd-021-graph-architecture.md) — **frozen contracts for spec #004 M1, not a shipped feature.** [#21](https://github.com/qodeca/erfana/issues/21) landed the architecture plus contract code that typechecks but is wired to nothing: no database file is created, no worker spawns, no IPC handler is registered, no preload bridge exists, no UI renders. #22–#32 implement against it. Eight parts, index in [§0](specs/designs/sd-021-graph-architecture.md#0-document-set): [architecture](specs/designs/sd-021-graph-architecture.md) (scope invariant, modules), [db-contracts](specs/designs/sd-021-db-contracts.md) (reader/writer topology, C1–C9), [db-schema](specs/designs/sd-021-db-schema.md) (STRICT DDL, two-phase search query, version gate), [ipc-contracts](specs/designs/sd-021-ipc-contracts.md) (channels, zod schemas), [mcp-contracts](specs/designs/sd-021-mcp-contracts.md) (MCP tool port/auth schemas, split from ipc §7.10), [worker-contracts](specs/designs/sd-021-worker-contracts.md) (worker-vs-chunked decision, message unions, restart ladder), [cross-cutting](specs/designs/sd-021-cross-cutting.md) (owner table, 26 error codes, security boundaries), [errata-and-risks](specs/designs/sd-021-errata-and-risks.md) (spec errata E1–E10, test plan, residual risks, supersession of `docs/future/graph-engine/`). Six `IGraph*` contract interfaces live in `src/main/interfaces/`. Spike evidence: [WAL concurrency](docs/graph/wal-concurrency-spike.md), [native dependencies](docs/graph/native-dependencies.md)
- [Source Grounding](docs/future/source-grounding/README.md) — NotebookLM-style grounding research, gap analysis, strategy, implementation roadmap
- [Roadmap](ROADMAP.md) — Delivery model, release map, and implementation order for active specs with dependency analysis

## Feature specifications

Feature specifications live in `specs/`. Check registry before implementing new features.

**Registry**: `specs/registry.json` — the authoritative list of active and archived specs (id, name, tier, status, path).

**Before implementing a feature**: Read the spec overview (`requirements/01-overview.md`), requirements (`requirements/02-requirements.md`), and acceptance criteria (`requirements/03-acceptance.md` for T3 specs; `requirements/04-acceptance.md` for T4, where `03` is use-cases).

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
- E2E: Playwright with Electron, Page Object Model pattern (see [docs/testing/e2e-testing.md](docs/testing/e2e-testing.md) for the POM classes, composed fixtures, and shared locator/wait helpers)
  - **Convention**: condition-based waits only – never `waitForTimeout`. Use the POM waits (`waitForPrompt()`, `waitForOutput()`), `waitForIpcComplete`, or Playwright auto-waiting
- Visual regression: Playwright `toHaveScreenshot()` for 5 UI states (welcome, editor, terminal, settings, confirm dialog); baselines in `e2e/screenshots/` with platform suffix; `--project=visual` in Playwright config; **runs locally only** – `macos-latest` CI hangs at `waitForLoadState('domcontentloaded')` ([docs/ci.md § Visual regression on CI](docs/ci.md#visual-regression-on-ci))
- E2E env vars: Some tests require API keys via `.env` file (see `.env.example`); tests skip gracefully if not set
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`)
- Windows-host flakes: catalogued in [`docs/windows/known-flakes.md`](docs/windows/known-flakes.md) with status legend + remediation-patterns cheat-sheet. Test-file split policy in [`docs/windows/contributing.md`](docs/windows/contributing.md) §"Test-file split policy" — split when mocks hoist to module scope (reference: `FileService.copyItem.limit.test.ts`, `WhisperModelManager.downgrade.test.ts`); keep in-file for per-describe `vi.useFakeTimers` (reference: `SettingsOverlay.test.tsx` Focus management)

## Continuous Integration
See [docs/ci.md](docs/ci.md) for the full pipeline map. Summary:
- **Branch-protection required checks** (not visible in the workflow files — a GitHub setting): `lint`, `typecheck`, `test`, `build`, `license`, and `Secret scan`. `windows-checks` is advisory and `e2e` is deliberately excluded until stable.
- **`e2e.yml`** — **disabled**: both functional `electron` and `visual` suites run locally only until macos-latest instability is root-caused. Re-enable with `gh workflow enable "E2E Tests"`. E2E is excluded from required checks, so disabling blocks no merges.
- **Every `npm ci` is wrapped in retry**: `npm ci || (sleep 10 && npm ci) || (sleep 20 && npm ci)` – handles transient ECONNRESET on GitHub runners.
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

Channel names and payload shapes are declared in `src/shared/ipc/*-channels.ts` / `*-schema.ts` — read those rather than duplicating them here. The invariants that are **not** visible from the schemas:

- **Clipboard** – backed by Electron's main-process `clipboard` module, never `navigator.clipboard`, so the sandbox stays on. `src/main/ipc/clipboard-handlers.ts` validates the sender frame (`event.senderFrame`, top-level + dev/`file://` origin only). The renderer `textClipboard` singleton (`src/renderer/src/services/textClipboard.ts`) is the **single** transport-error chokepoint (retry-once + debounced toast) — don't call the bridge directly.
- **Claude Code status** – register carries `terminalId` only; the PTY pid is resolved main-side and is **never** trusted from the renderer.
- **Graph engine** – **declared and schema-frozen by [#21](https://github.com/qodeca/erfana/issues/21); NO handler, NO preload bridge, NO renderer caller exists yet.** Do not treat these as live channels; #26 registers the handlers and adds the `api.graph` bridge. Requests use `strictObject` (an unknown key is rejected, not stripped), every payload carries a `correlationId`, and paths are project-relative and confinement-checked. The 26 `GRAPH_*` / `MCP_*` error codes are contract-only until #23–#32 raise them.

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status runs in a worker thread via `worker_threads` (isomorphic-git default, native `git status --porcelain` fallback for large repos); global `.gitignore` not supported by isomorphic-git

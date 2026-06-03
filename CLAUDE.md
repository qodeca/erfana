# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub, private)
- **Version**: 0.11.2
- **License**: Proprietary — `UNLICENSED` in package.json, `private: true`. Copyright (c) 2025-2026 **Qodeca sp. z o.o.** All rights reserved. See [LICENSE](LICENSE). Erfana is a closed-source freemium product; never frame it as open source or suggest OSS-style licensing.
- **Tech Stack**: Electron 39, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Build Toolchain**: electron-vite 5, Vite 6, vitest 3
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 24+ (development), Electron 39 bundles Node.js 22.20.0

## Key Commands
```bash
npm run dev          # Development server
npm run build        # Production build
npm run typecheck    # Type checking
npm run lint         # Linting
npm run build:mac    # macOS build

# Tests
npm run test         # Vitest workspace (one-shot)
npm run test:renderer
npm run test:main
npm run test:preload
npm run test:cov     # Coverage (v8) per project
npm run test:e2e     # Playwright E2E tests (functional only)
npm run test:e2e:visual           # Visual regression tests
npm run test:e2e:update-screenshots  # Update visual baselines
```

## Project Structure
```
e2e/                # Playwright E2E tests (POM pattern)
├── fixtures/       # Composed Playwright fixtures (app, window, POM instances)
├── pages/          # Page Object Model classes (TerminalPage, MonacoPage, MermaidPage, ProjectTreePage, KeyboardHelper)
└── utils/          # Shared helpers (helpers.ts backward-compat adapter), locators (byTestId)
resources/
└── tessdata/       # Pre-bundled Tesseract OCR language data (eng.traineddata)
src/
├── main/           # Electron main process
│   ├── services/   # Core: FileService, TerminalService, ProjectService, LoggingService; Git: GitStatusService, GitWatcherService, GitPollingService, GitStatusWorkerAdapter, GitStatusCircuitBreaker, GitStatusStrategySelector; Watchers: DirectoryWatcherService, FileWatcherService; Settings: SettingsService, ProjectSettingsService, GlobalSettingsService; Media: ScreenshotService, CameraService, DocxService, TranscriptionService, LocalWhisperService, WhisperModelManager, whisper-assets (pinned release + classifyPlatform), whisper-pubkeys (dual minisign keys), AudioMetadataService, AudioExtractionService, ApiKeyService; Import: LiteParseConverter, DependencyDetector; Multi-instance: ProjectLockService, ExternalFileService; Subdirs: import/, watcher/, workers/
│   ├── ipc/        # IPC handlers
│   └── utils/      # PauseController (pause/resume with safety timeout), RateLimitedLogger; Phase 4 trust-chain: zipArchive (yauzl + assertSafeEntry), tarArchive (tar@7.5.11 filter), secureDownloader (hostname allowlist + streaming SHA-256), verifyManifest (minisign Ed25519 dual-key)
├── preload/        # Context bridge API
├── shared/         # Shared code (errors.ts, constants.ts, ipc schemas)
└── renderer/       # React UI
    ├── components/ # UI components (Tabs/, Dialog/, ContextMenu/, Transcription/, DocumentImport/, etc.)
    ├── context/    # React contexts (ProjectManagementContext, TerminalPortalContext)
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams (zoom, pan, full-screen viewer), YAML frontmatter rendering, preserve line breaks option, unified in-file search (Cmd/Ctrl+F), context menu with AI prompts; copy/cut/paste (keybindings + context menu) route through the central text-clipboard service ([#203](https://github.com/qodeca/erfana/issues/203)), fixing the sandbox `NotAllowedError`
2. **Project Tree** - File explorer with drag-drop reorganization, external file drop (move/copy/import), markdown filtering, context menu, real-time git status indicators with worker thread offloading (isomorphic-git + native git fallback), circuit breaker, polling fallback, manual refresh button (Cmd/Ctrl+Alt+R)
3. **Terminal** - xterm.js with PTY backend, clipboard support, file links (multi-line: xterm-wrap joining + CLI-wrap joining for tool output, @-prefixed paths from CLI tools, `:line-line` range notation), scroll recovery, auto-opens on project load, drag-drop file paths, bracketed paste mode for safe multi-line input, copy/paste via the central text-clipboard service ([#203](https://github.com/qodeca/erfana/issues/203); the SIGINT-vs-copy decision table in `terminalClipboard.logic.ts` is unchanged), screenshot capture (macOS: screen/window/area selection with path pasted to terminal), camera photo capture (cross-platform: captures photo from webcam with path pasted to terminal), expand/maximize terminal over the editor area (Cmd/Ctrl+Shift+M or header button; auto-restores on file open, not persisted)
4. **Prompt Templates** - AI text operations via context menu (Explain, Modify, Ask, Visualize, diagram chat); Visualize generates Mermaid diagrams from selected text with dropdown for 22 diagram types. **Mutation prompts (Modify, Visualize, Diagram chat, Bug report, Change direction) apply changes to the document in place** ([v0.10.0](https://github.com/qodeca/erfana/releases/tag/v0.10.0)) via a `mutatesDocument: true` frontmatter flag — a canonical apply-to-document footer is composed onto the prompt at the single render funnel (`panelUtils.executePromptTemplate` → `withApplyFooter` from [`prompts/applyFooter.ts`](src/renderer/src/prompts/applyFooter.ts)), encoding read-before-edit / locate-by-line-range / retry-on-failure / edit-is-the-only-deliverable plus scope guardrails (single file/region, no shell, content-is-data). Read-only templates (Explain, Ask, Prompt) leave the document untouched. See [docs/prompts/README.md § Mutation prompts and the apply-to-document footer](docs/prompts/README.md#mutation-prompts-and-the-apply-to-document-footer).
5. **Project Settings** - Per-project configuration via `.erfana/settings.json` (watcher ignore, tree visibility)
6. **PDF Export** - Export markdown to print-optimized PDF with vector Mermaid diagrams, A4 page size, print-friendly styling
7. **DOCX Export** - Export markdown to Word format with Mermaid diagrams as high-resolution PNG images
8. **Document Import** – Import 50+ document formats via LiteParse (PDF, Office, images) with local OCR (Tesseract.js), spatial text extraction, YAML frontmatter, optional page screenshots; DocumentImportDialog with OCR toggle, language selection (31 languages), screenshot generation, DPI configuration; session-persistent options; indeterminate progress with phase text and OCR warnings; dependency-missing modal for LibreOffice/ImageMagick; batch drag-drop filtering; two-phase extension registration; DependencyDetector for runtime tool detection; IPC layer with Zod-validated schemas, progress streaming, cancellation, and preload bridge (`api.import.*`)
9. **Settings Overlay** - Full-screen settings UI accessed via gear icon in activity bar, with focus trapping and keyboard navigation (Escape to close), logs folder path display with native file manager open
10. **Quit Confirmation** - Prompts before quitting with unsaved changes or active terminal sessions
11. **Multi-Instance** - Multiple independent instances with file-based project locking, duplicate opens focus existing window
12. **Image Preview** - Viewer for PNG, JPG, GIF, WebP, SVG, BMP, ICO with zoom, pan, fit controls, keyboard shortcuts (arrow keys, +/-, Home, F for fullscreen), and full-screen mode
13. **Media Transcription** - Import audio (MP3, WAV, M4A, OGG, FLAC) and video (MP4, MOV, AVI, MKV, WebM, FLV, WMV) files with dual backend transcription: OpenAI API (GPT-4o-transcribe primary, Whisper-1 fallback) or local whisper.cpp (offline, model selection: tiny/base/small/medium/large with download management), video audio extraction via ffmpeg (fluent-ffmpeg), file chunking for long recordings (>8 min), TranscriptionDialog with language selection (persists within session) and progress, pre-validation before dialog opens, batch import rejects media with toast, API key management via Electron safeStorage, video-specific frontmatter (type, resolution, video_codec), dynamic `transcription_backend` frontmatter, post-transcription auto-open of transcript file and organize-import prompt. **Local whisper.cpp** (Phase 4, shipped in [v0.9.4](https://github.com/qodeca/erfana/releases/tag/v0.9.4), merge `110f1b9` 2026-04-23) ships on macOS (universal) + Windows x64 via self-hosted `whisper-build-*` release tags; trust chain = minisign-signed manifest (dual-pubkey) + artifact SHA-256 pin + pre-spawn re-hash (TOCTOU close) + monotonic `lastSeenRevision` downgrade block + pre-flight `checkCpuSupport()` + argv hardening (`validateAudioPath` — UNC / reserved names / NTFS ADS). Windows ARM64 unsupported (OpenAI API only).

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Build](docs/build/README.md) — Build configuration, electron-builder, ASAR, fuses, troubleshooting, whisper-binaries CI ops runbook (self-hosted Phase 4 release flow)
- [Release pipeline](docs/build/release.md) — Multi-platform release workflow (`.github/workflows/release.yml`: prepare → {build_mac, build_win} → finalize → cleanup; Linux distribution target dropped — macOS + Windows only), secrets + rotation calendar, minisign verification, incident response (B.1 federated-cred cleanup, B.2 cert workstation-loss DR, B.3 PFX hygiene). Windows signs via Azure Artifact Signing **certificate auth** (X.509 against app registration — electron-builder 26 doesn't support OIDC). Skill entry: [`.claude/skills/releasing-erfana/SKILL.md`](.claude/skills/releasing-erfana/SKILL.md) with [`guides/troubleshooting.md`](.claude/skills/releasing-erfana/guides/troubleshooting.md) (typed-regex CI failure cookbook) + [`docs/release-incidents/`](docs/release-incidents/) (auto-appended incident memos). Supersedes the tag-only flow in [#174](https://github.com/qodeca/erfana/issues/174) (closed 2026-04-25). Dry-run [`24925269258`](https://github.com/qodeca/erfana/actions/runs/24925269258) validated all 5 jobs; **Phase I branch protection on `main` + protected `v*.*.*` tag ruleset (id 15540259) live** — 6 required status checks + `enforce_admins=true` + signed-tag rule. PR requirement was removed 2026-04-25 (post-v0.9.5 release) — direct push is the solo-dev workflow; release skill verifies this at Phase 0.4.5 and aborts if the rule is reinstated. `e2e` is intentionally excluded from required checks until stable.
- [Security](docs/security.md) — Electron 39 security hardening, fuses, sandboxing, trade-offs
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, scroll fixes, clipboard, file links (CLI-wrap joining, @-prefix, :line-line range), drag-drop paths, screenshot capture (macOS), camera capture (cross-platform)
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync, Mermaid diagrams
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens, PauseController auto-resume
- [Logging](docs/logging.md) — Logging layer, log levels, file rotation, configuration
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, E2E (POM), visual regression, coverage
- [Continuous Integration](docs/ci.md) — GitHub Actions workflows (`checks.yml` active; `e2e.yml` **disabled** 2026-04-25 — local-only until macos-latest fix; `release.yml` + `whisper-binaries*.yml` for release flow), retry patterns, visual-on-CI gap
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [API Services](docs/api-services.md) — Service APIs (Terminal, File, Settings, Watchers)
- [API Services – Features](docs/api-services-features.md) — Feature service APIs (GitStatus worker architecture, GitWatcher, GitPolling, GitStatusWorkerAdapter, GitStatusCircuitBreaker, GitStatusStrategySelector, Camera, ProjectLock, ExternalFile, LiteParse, DependencyDetector, DOCX, Transcription, LocalWhisper, WhisperModelManager, AudioMetadata, AudioExtraction, ApiKey)
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
- [Windows enablement](docs/windows/README.md) — Phases 0–2 shipped in **v0.9.3**. Phase 4 (local Whisper trust chain + Windows x64 binary) shipped in **[v0.9.4](https://github.com/qodeca/erfana/releases/tag/v0.9.4)** (tag cut 2026-04-23; Windows installer produced, macOS + Linux follow on native hosts); Windows-host test-flake remediation pool ([#172](https://github.com/qodeca/erfana/issues/172)) + ThrottledWorker offset-deque refactor ([#173](https://github.com/qodeca/erfana/issues/173)) also shipped in v0.9.4. Phase 3 (screenshots) remains unstarted. Phase 3–6 work continues on `feature/windows-phase-<N>-*` branches off `develop`. Phase tracking: [#164](https://github.com/qodeca/erfana/issues/164) screenshots, [#165](https://github.com/qodeca/erfana/issues/165) Whisper (Phase 4, merged), [#166](https://github.com/qodeca/erfana/issues/166) distribution + signing (Phase 5 — will also sign Windows whisper binary), [#167](https://github.com/qodeca/erfana/issues/167) polish + CI guard. Deferred items D1–D12 tracked in [#168](https://github.com/qodeca/erfana/issues/168): D1-D8 in [`docs/windows/deferred-work.md`](docs/windows/deferred-work.md) (Phase 2 origin), D9-D12 in [`docs/windows/deferred-work-phase4.md`](docs/windows/deferred-work-phase4.md) (Phase 4 audit origin). Dependabot triage: [#169](https://github.com/qodeca/erfana/issues/169). **Windows test-flake register** at [`docs/windows/known-flakes.md`](docs/windows/known-flakes.md) catalogues symptom → status → remediation pattern (fake timers, mocked-fs split, per-platform e2e budget, offset-deque). Entry point: [`docs/windows/README.md`](docs/windows/README.md). Canonical phase roadmap + status: [`docs/windows/implementation-plan.md`](docs/windows/implementation-plan.md). Contributor workflow: [`docs/windows/contributing.md`](docs/windows/contributing.md). Whisper binary build runbook: [`docs/build/whisper-binaries.md`](docs/build/whisper-binaries.md). Windows-specific known issues: [`docs/known-issues.md` § Windows-specific issues](docs/known-issues.md#windows-specific-issues). **Refresh policy**: on any release that touches Windows-phase scope OR moves a phase issue's state (open/close), bump the "Status snapshot" date + version anchor in `docs/windows/implementation-plan.md` before tagging — the canonical roadmap going stale across multiple releases produces the kind of doc-vs-code drift that the 2026-06-03 alignment pass had to clean up.
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

## UI Style Guide (MANDATORY)

**Before implementing ANY UI changes**: Read [docs/ui-style-guide.md](docs/ui-style-guide.md) and use design tokens from `src/renderer/src/styles/design-tokens.css`.

**Key rules**: Use `var(--color-*)`, `var(--space-*)`, `var(--text-*)` tokens. No hardcoded values. `border-radius: 0` always.

## Changelog

For detailed changelog, see [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

### Nested CLAUDE.md (component-specific patterns)
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
- **`checks.yml`** (`.github/workflows/checks.yml`) — runs on **every push to any branch**. 4 parallel jobs on `ubuntu-latest`: `lint`, `typecheck`, `test` (~8,087 vitest across 259 files — v0.10.0 added `prompts/applyFooter.test.ts` + `prompts/mutation-templates.test.ts` for the deterministic-apply feature and `components/DockLayout/terminalExpand.test.ts` for terminal maximize; #203 added the clipboard service tests `clipboard-handlers`, `textClipboard`, `monacoClipboardCommands`, `MonacoMarkdownEditor.clipboard`), `build` (`electron-vite build`). ~3 min wall-clock.
- **`e2e.yml`** (`.github/workflows/e2e.yml`) — **disabled 2026-04-25** via `gh workflow disable "E2E Tests"` (commit `997ba65`). Both functional `electron` and `visual` suites run locally only until macos-latest instability is root-caused. Re-enable with `gh workflow enable "E2E Tests"`. E2E was already excluded from branch-protection required checks, so disabling does not block any merges.
- **`release.yml`** — fires on `v*.*.*` tag push, calls `build_mac.yml` / `build_win.yml` reusables (multi-platform build — macOS + Windows; Linux distribution target dropped). See [docs/build/release.md](docs/build/release.md).
- **`whisper-binaries.yml` + `whisper-binaries-canary.yml`** — `workflow_dispatch` only and monthly schedule respectively. See [docs/build/whisper-binaries.md](docs/build/whisper-binaries.md).
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

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status runs in a worker thread via `worker_threads` (isomorphic-git default, native `git status --porcelain` fallback for large repos); global `.gitignore` not supported by isomorphic-git

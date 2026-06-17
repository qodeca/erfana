# ERFANA - Project Instructions for Claude

## Project Overview
An agent-native Markdown workspace (Electron) that runs terminal coding agents like Claude Code beside the editor — integrated terminal with a live Claude Code context-window meter, Monaco editor + live preview, and a project tree. Positioning: an "agent-native Markdown workspace," agent-agnostic with Claude Code as the lead example; Erfana hosts/companions the agent (it is not itself an AI model — never overclaim built-in AI). Note: the context-window meter is Claude Code-specific (reads `~/.claude` transcripts); the terminal itself runs any CLI agent.
- **Repository**: `qodeca/erfana` (GitHub, public)
- **Version**: 0.16.1
- **License**: `GPL-3.0-only` (open source). Copyright (c) 2025-2026 **Qodeca sp. z o.o.** See [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT) (relicensing record). Per-file licensing follows the [REUSE](https://reuse.software) spec (SPDX headers + `REUSE.toml`); third-party notices are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). The code is GPL; the "Erfana"/"Qodeca" names and logos remain Qodeca trademarks (see [TRADEMARKS.md](TRADEMARKS.md)) — forks must rebrand. Contributions require the project CLA (see [CLA.md](CLA.md)), which preserves Qodeca's dual-licensing option. `"private": true` in package.json is a publish guard for the desktop app, not a license statement.
- **Tech Stack**: Electron 39, React 18, TypeScript 6.0, Monaco Editor, xterm.js
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
│   ├── services/   # Core: FileService, TerminalService, ProjectService, LoggingService; Git: GitStatusService, GitWatcherService, GitPollingService, GitStatusWorkerAdapter, GitStatusCircuitBreaker; Watchers: DirectoryWatcherService, FileWatcherService; Settings: SettingsService, ProjectSettingsService, GlobalSettingsService; Media: ScreenshotService (dispatcher → screenshot/ subdir with MacScreenshotCapturer + DesktopCapturerScreenshotCapturer + ScreenshotOverlayWindow [#164]), CameraService, DocxService, TranscriptionService, LocalWhisperService, WhisperModelManager, whisper-assets (pinned release + classifyPlatform), whisper-pubkeys (dual minisign keys), AudioMetadataService, AudioExtractionService, ApiKeyService; Import: LiteParseConverter, DependencyDetector; Claude status: claudeStatus/ (ClaudeStatusService orchestrator, ClaudeTranscriptWatcher [refcounted chokidar on ~/.claude/projects], ClaudeTranscriptParser, ClaudeTranscriptLocator, ClaudeWindowDetector [model-capability registry 200k/1M], friendlyModelName, encodeCwd [platform-branched: macOS `/`+`.`→`-`, Windows `/`+`\`+`:`+`.`→`-`], process/{MacClaudeProcessDetector, WinClaudeProcessDetector [#217], exec (shared ExecLike), createProcessDetector}); Multi-instance: ProjectLockService, ExternalFileService; Subdirs: import/, watcher/, workers/, screenshot/, claudeStatus/
│   ├── ipc/        # IPC handlers
│   └── utils/      # PauseController (pause/resume with safety timeout), RateLimitedLogger; Phase 4 trust-chain: zipArchive (yauzl + assertSafeEntry), tarArchive (tar@7.5.16 filter), secureDownloader (hostname allowlist + streaming SHA-256), verifyManifest (minisign Ed25519 dual-key)
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
2. **Project Tree** - File explorer with drag-drop reorganization, external file drop (move/copy/import), markdown filtering, context menu (incl. **Reveal in Finder/Explorer** — reveals the file, folder, or project-root node in the native file manager via `file:revealInFileManager`, which is sender-validated + project-confined and calls `shell.showItemInFolder`; OS-specific label via `isMacOS()`/`isWindows()`; last item below Delete; unavailable when the tree shows no files since the root node is not rendered), real-time git status indicators with worker thread offloading (isomorphic-git + native git fallback), circuit breaker, polling fallback, manual refresh button (Cmd/Ctrl+Alt+R); badges auto-refresh on create / delete / rename **and** in-place content edits via the chokidar `change` listener in `DirectoryWatcherService` ([#241](https://github.com/qodeca/erfana/issues/241)) — `.git/` events are filtered in favor of `GitWatcherService` to avoid duplicate refresh requests during git operations
3. **Terminal** - xterm.js with PTY backend, clipboard support, file links (multi-line: xterm-wrap joining + CLI-wrap joining for tool output, @-prefixed paths from CLI tools, `:line-line` range notation), scroll recovery, auto-opens on project load, drag-drop file paths, bracketed paste mode for safe multi-line input, copy/paste via the central text-clipboard service ([#203](https://github.com/qodeca/erfana/issues/203); the SIGINT-vs-copy decision table in `terminalClipboard.logic.ts` is unchanged), **cross-platform screenshot capture** (macOS native `screencapture` for screen/window/area; Windows + Linux via Electron `desktopCapturer` with in-app `WindowPickerDialog` thumbnail grid and a frameless transparent area-select overlay; [#164](https://github.com/qodeca/erfana/issues/164); path pasted to terminal), camera photo capture (cross-platform: captures photo from webcam with path pasted to terminal), expand/maximize terminal over the editor area (Cmd/Ctrl+Shift+M or header button; auto-restores on file open, not persisted), per-panel **Claude Code context status bar** (macOS + Windows [#217]; see Core Feature 14 and `claude-status:*` channels), **bundled Cascadia Mono font** (vendored under `src/renderer/src/assets/fonts/`, SIL OFL; first in the terminal font stack so rendering is identical cross-platform; `ensureTerminalFontLoaded` awaits it via the CSS Font Loading API before `xterm.open()` to avoid canvas glyph-metric mismeasure; see [docs/terminal/README.md](docs/terminal/README.md))
4. **Prompt Templates** - AI text operations via context menu (Explain, Modify, Ask, Visualize, diagram chat); Visualize generates Mermaid diagrams from selected text with dropdown for 22 diagram types. **Mutation prompts (Modify, Visualize, Diagram chat, Bug report, Change direction) apply changes to the document in place** ([v0.10.0](https://github.com/qodeca/erfana/releases/tag/v0.10.0)) via a `mutatesDocument: true` frontmatter flag — a canonical apply-to-document footer is composed onto the prompt at the single render funnel (`panelUtils.executePromptTemplate` → `withApplyFooter` from [`prompts/applyFooter.ts`](src/renderer/src/prompts/applyFooter.ts)), encoding read-before-edit / locate-by-line-range / retry-on-failure / edit-is-the-only-deliverable plus scope guardrails (single file/region, no shell, content-is-data). Read-only templates (Explain, Ask, Prompt) leave the document untouched. See [docs/prompts/README.md § Mutation prompts and the apply-to-document footer](docs/prompts/README.md#mutation-prompts-and-the-apply-to-document-footer).
5. **Project Settings** - Per-project configuration via `.erfana/settings.json` (watcher ignore, tree visibility)
6. **PDF Export** - Export markdown to print-optimized PDF with vector Mermaid diagrams, A4 page size, print-friendly styling
7. **DOCX Export** - Export markdown to Word format with Mermaid diagrams as high-resolution PNG images
8. **Document Import** – Import 50+ document formats via LiteParse (PDF, Office, images) with local OCR (Tesseract.js), spatial text extraction, YAML frontmatter, optional page screenshots; DocumentImportDialog with OCR toggle, language selection (31 languages), screenshot generation, DPI configuration; session-persistent options; indeterminate progress with phase text and OCR warnings; dependency-missing modal for LibreOffice/ImageMagick; batch drag-drop filtering; two-phase extension registration; DependencyDetector for runtime tool detection; IPC layer with Zod-validated schemas, progress streaming, cancellation, and preload bridge (`api.import.*`)
9. **Settings Overlay** - Full-screen settings UI accessed via gear icon in activity bar, with focus trapping and keyboard navigation (Escape to close), logs folder path display with native file manager open
10. **Quit Confirmation** - Prompts before quitting with unsaved changes or active terminal sessions
11. **Multi-Instance** - Multiple independent instances with file-based project locking, duplicate opens focus existing window
12. **Image Preview** - Viewer for PNG, JPG, GIF, WebP, SVG, BMP, ICO with zoom, pan, fit controls, keyboard shortcuts (arrow keys, +/-, Home, F for fullscreen), and full-screen mode
13. **Media Transcription** - Import audio (MP3, WAV, M4A, OGG, FLAC) and video (MP4, MOV, AVI, MKV, WebM, FLV, WMV) files with dual backend transcription: OpenAI API (GPT-4o-transcribe primary, Whisper-1 fallback) or local whisper.cpp (offline, model selection: tiny/base/small/medium/large with download management), video audio extraction via ffmpeg (fluent-ffmpeg), file chunking for long recordings (>8 min), TranscriptionDialog with language selection (persists within session) and progress, pre-validation before dialog opens, batch import rejects media with toast, API key management via Electron safeStorage, video-specific frontmatter (type, resolution, video_codec), dynamic `transcription_backend` frontmatter, post-transcription auto-open of transcript file and organize-import prompt. **Local whisper.cpp** ships on macOS (universal) + Windows x64 via self-hosted `whisper-build-*` release tags; trust chain = minisign-signed manifest (dual-pubkey) + artifact SHA-256 pin + pre-spawn re-hash (TOCTOU close) + monotonic `lastSeenRevision` downgrade block + pre-flight `checkCpuSupport()` + argv hardening (`validateAudioPath` — UNC / reserved names / NTFS ADS). Windows ARM64 unsupported (OpenAI API only).
14. **Terminal Claude Code status bar** (macOS + Windows) – A thin status bar (height matches the Project sidebar footer, `var(--header-height)`) at the bottom of a terminal panel, visible only while Claude Code (`claude` CLI) is actively running in that panel. Shows the friendly model name (e.g. "Opus 4.8"), a context-window-size badge (200k vs 1M), the context-used %, and a green/orange/red `role="meter"` progress bar (true green `--color-context-safe` #3fb950 in the safe band; thresholds 30% / 60% of the active window) that fills the width between the badge and the right-pinned percentage; a native-title hover tooltip shows exact tokens ("84k / 200k"). Display-only, always on. Data is read **non-invasively** (read-only) from Claude Code's own transcript JSONL under `~/.claude/projects/<encoded-cwd>/*.jsonl` – Erfana never writes the user's Claude Code config. Spawned terminals strip `CLAUDECODE` and `CLAUDE_CODE_*` from the child env (but keep `ANTHROPIC_*`, e.g. API keys) so an in-terminal `claude` runs as a clean top-level session that persists its own transcript. Transcript selection is **turn-aware**: the locator returns the newest candidate files (up to `MAX_CANDIDATES`, exported and reused as the service's `MAX_PARSE_ATTEMPTS` so the two cannot drift) and the parser picks the newest one that yields a real conversation turn, skipping metadata-only sidecar JSONLs (`ai-title` / `last-prompt` / `mode`) that would otherwise shadow the real transcript by mtime. Per-panel detection inspects the panel's own PTY child-process tree for a `claude` process (macOS `ps`/`lsof`) and uses that process's live cwd to locate the transcript. Transcript selection is **floored by the running process's start time** (`ps lstart`): files modified before `claude` launched (minus a 2s clock-skew tolerance) are excluded, so a freshly-launched session hides until it writes its own first turn instead of mis-reporting a *prior* session's context (fixes the "% already filled on launch" bug); `claude --continue` still resolves because resume bumps the reused transcript's mtime above the floor, and an unresolved start time degrades to no floor. Window size uses a model-capability registry (Claude Code auto-upgrades **Opus 4.6+** to the 1M window with no on-disk marker; Opus 4.5/older, all Sonnet incl. sonnet-4-6, and all Haiku stay 200k — but observed usage > 200k or a settings.json `[1m]` model still force 1M). On any detection/parse failure the bar hides gracefully (no error, no stale data). **macOS and Windows** are both supported ([#217](https://github.com/qodeca/erfana/issues/217) added Windows): on Windows the per-panel detector resolves the PTY child-process tree via a single static `powershell.exe -NoProfile -NonInteractive` `Get-CimInstance Win32_Process` query (JSON snapshot, BFS over the tree, fail-closed, 8s liveness-cache TTL, start-time floor projected from the snapshot's `CreationDate`; `powershell.exe` resolved by absolute path off `%SystemRoot%` with cwd pinned to System32 and no pid interpolation), and `encodeCwd` is platform-branched (Windows replaces `/`, `\`, `:`, `.` with `-`, e.g. `C:\Users\x\Projects\erfana` → `C--Users-x-Projects-erfana`). Windows v1 does not resolve Claude's *live* cwd, so it falls back to the panel's spawn cwd (the bar hides if the user `cd`s elsewhere before launching `claude`); Linux stays a no-op (bar never appears). Both detectors share an `AbstractClaudeProcessDetector` base (BFS + `isValidPid` + a **single-flight, transient-error-aware, `forget(pid)`-evicting** liveness cache; per-OS TTL). Post-compaction the bar shows ~0% and a **sticky 1M window** prevents a visible 1M→200k snap-back, but the stickiness is **scoped to the current model** (per-terminal, reset on pid change, a model-id switch, or an explicit standard `/model` override) so a mid-session model switch still re-evaluates the window in both directions (e.g. Opus 1M → Sonnet 200k → Opus 1M); detection still uses the real pre-compaction token count; the transcript parser retries a full read once if a large compaction summary evicts the turn from the 256 KB tail window. The Windows cwd→dir encoding is inferred/lossy, so the locator also tries a normalized (trailing-separator-stripped) alternate via `candidateProjectDirs`. See [docs/designs/216-claude-status-bar.md §10.1](docs/designs/216-claude-status-bar.md).

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
- [Continuous Integration](docs/ci.md) — GitHub Actions workflows (`checks.yml` active; `e2e.yml` **disabled** — local-only until macos-latest fix; `release.yml` + `whisper-binaries*.yml` for release flow), retry patterns, visual-on-CI gap
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
- **`checks.yml`** (`.github/workflows/checks.yml`) — runs on **every push to any branch**. 4 parallel jobs on `ubuntu-latest`: `lint`, `typecheck`, `test` (the full vitest workspace — main/renderer/preload), `build` (`electron-vite build`). ~3 min wall-clock. Plus an advisory `windows-checks` job on `windows-latest` (typecheck + `test:main` only; `shell: bash`; not a branch-protection required check until proven stable).
- **`e2e.yml`** (`.github/workflows/e2e.yml`) — **disabled**: both functional `electron` and `visual` suites run locally only until macos-latest instability is root-caused. Re-enable with `gh workflow enable "E2E Tests"`. E2E is excluded from branch-protection required checks, so disabling blocks no merges.
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
- Claude Code status channels (`src/shared/ipc/claude-status-channels.ts`, `claude-status-schema.ts`) – per-terminal Claude Code context status bar (macOS + Windows). Register carries `terminalId` only; the PTY pid is resolved main-side (never trusted from the renderer):
  - `claude-status:register` – Register a terminal panel for status tracking (invoke)
  - `claude-status:unregister` – Stop tracking a panel (invoke; on PTY exit / panel unmount)
  - `claude-status:nudge` – Request an immediate refresh for a panel (invoke)
  - `claude-status:changed` – Snapshot update for a `terminalId` (main → renderer push)

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status runs in a worker thread via `worker_threads` (isomorphic-git default, native `git status --porcelain` fallback for large repos); global `.gitignore` not supported by isomorphic-git

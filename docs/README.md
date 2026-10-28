# Erfana Documentation

## Overview
Erfana is an agent-native Markdown workspace – an Electron app that runs a terminal coding agent such as Claude Code beside the editor, with live preview, a project tree, and a Claude Code context-window meter.

## User guide

- [Erfana user guide](./user-guide/README.md) – Illustrated walkthroughs and reference for people using Erfana
- [About Erfana and Qodeca](./about.md) – Why Erfana is open source, how it is licensed, and who builds it

## Onboarding (For New Developers)
- [Getting Started](./getting-started.md) – Day 1 setup and orientation
- [Quick Reference](./quick-reference.md) – Command cheat sheet and common workflows
- [Glossary](./glossary.md) – Project terminology and definitions

## Documentation Structure

### Core Documentation
- [Architecture](./architecture.md) - System architecture and design patterns
- [API Services](./api-services.md) - Main process services and IPC handlers
- [API Services – Features](./api-services-features.md) - Feature service implementations (Git, Transcription, Camera, etc.)
- [IPC Patterns](./ipc-patterns.md) - Inter-process communication patterns
- [Security](./security.md) - Security considerations and implementations
- [Error Codes](./error-codes.md) - Project-wide `ErrorCode` enum index (grouped by category; operator actions for the most-visible ones). Includes the graph/MCP block, which is contract-only until #23-#32 raise it
- [Architecture Decision Records](./adrs/README.md) - Durable rationale for load-bearing design choices; the index lists every record
- [Technical Debt](./technical-debt.md) - Technical debt tracking and priorities

### Feature Documentation
- [Core features](./features/README.md) - Catalogue of the shipped features (editor, project tree, terminal, prompt templates, export, import, transcription, Claude Code status bar). Referenced from the root `CLAUDE.md` rather than inlined there
- [Editor](./editor/README.md) - Monaco editor, markdown preview, scroll sync, Mermaid diagrams (full-screen viewer), PDF/DOCX export
  - [Export](./editor/export.md) - PDF and DOCX export pipeline
  - [Mermaid Viewer](./editor/mermaid-viewer.md) - Full-screen diagram viewer with zoom and pan
- [HTML Preview](./html-preview/README.md) - Live `.html` preview running real CSS + JS in a sealed process, with a per-project host allowlist, auto-refresh, find-in-page and PDF export (issue #74), plus same-project frames, same-tab links with Back and Forward, Open in default browser, and keyboard entry into the page (issue #124). Threat model in [Security § HTML preview](./security.md#html-preview)
- [HTML comments – format v1](./html-comments/format-v1.md) - Draft public spec of the `erfana:comment v1` block that HTML Preview comments store in the `.html` file: grammar, `@data` schema, escaping, placement, damaged blocks and rules for coding agents
- [Image Viewer](./ui-components.md#image-viewer-panel) - Image preview panel with zoom, pan, and fullscreen
- [Terminal](./terminal/README.md) - xterm.js terminal integration
  - [Bootstrap Pattern](./terminal/bootstrap-pattern.md) - Clean initialization without artifacts
  - [Scroll Fixes](./terminal/scroll-fixes.md) - v0.3.1 scroll preservation and scroll to bottom button
  - [Flickering Prevention](./terminal/flickering-prevention.md) - v0.3.2 rendering stability fixes
  - [Troubleshooting](./terminal/troubleshooting.md) - Known issues and solutions
- [Project Panel](./project-panel.md) - File explorer and project management
- [Drag-Drop](./drag-drop/README.md) - VS Code-style file reorganization, external file drop, keyboard shortcuts
- [File Watching](./file-watching/README.md) - Auto-refresh and file monitoring: the native project watcher on macOS and Windows, chokidar on Linux and for single files, content-only saves that skip the tree re-read
  - [Patterns & Testing](./file-watching/patterns-and-testing.md) - Implementation patterns and test scenarios
  - [Technical Details](./file-watching/technical-details.md) - Performance, security, edge cases
- [Prompt Templates](./prompts/README.md) - context-menu templates that send a selection to the CLI agent in the terminal (v0.3.4)
  - [AutoExecute Overview](./prompts/autoexecute-overview.md) - Feature overview and architecture
  - [AutoExecute Technical](./prompts/autoexecute-technical.md) - Write pipeline and 200ms delay rationale
  - [AutoExecute Testing](./prompts/autoexecute-testing.md) - Test coverage and mocking strategy
  - [AutoExecute Reference](./prompts/autoexecute-reference.md) - Implementation files and error handling
- [Logging](./logging.md) - Logging layer, log levels, file rotation, settings
- [Settings](./settings.md) - Settings overlay implementation notes: storage and parse rules, API-key and model storage, the `files.exclude` list, terminal screen-reader mode. The user-facing list of settings is the [settings reference](./user-guide/reference/settings.md)

### UI/UX
- **[Design system](design-system/index.html)** - the cards that decide colours, type, spacing, surfaces, focus, motion, layering and each component (MANDATORY for UI changes; open it in a browser)
- [UI Style Guide](./ui-style-guide.md) - text-selection policy and the dark-only stance; its visual sections are stubs pointing at the cards
- [UI Style Guide Reference](./ui-style-guide-reference.md) - common token gotchas left over from the v0.5.3 token migration
- [UI Components](./ui-components.md) - React component architecture
- [Keyboard Shortcuts](./keyboard-shortcuts.md) - Application keyboard shortcuts

### Development
- [Development Tasks](./development-tasks.md) - Build, test, and deployment
- [Continuous Integration](./ci.md) - GitHub Actions workflows (`checks.yml` on every push, carrying six of the seven required checks – the seventh, `Secret scan`, is `secret-scan.yml`; the macOS `e2e.yml` **disabled** since 2026-04-25, with the advisory `E2E (Linux, xvfb)` job in `e2e-linux.yml` as the only e2e run on pull requests; `release.yml` and `whisper-binaries*.yml` for release flow), retry patterns, visual-on-CI gap
- [Build](./build/README.md) - electron-builder, ASAR, fuses, troubleshooting
- [Release signing keys](./release-pubkey.txt) - Published minisign public keys (primary + standby rotation) for verifying release artifacts
- [Windows Enablement](./windows/README.md) - Phase roadmap, Windows-only behaviour and the test-flake register. **[`implementation-plan.md`](./windows/implementation-plan.md) § Status snapshot is the canonical status.** Issue, PR and release numbers from before the public-repo migration do not resolve on `qodeca/erfana`; the provenance banner at the top of each `docs/windows/` file explains how they are kept
  - [Implementation Plan](./windows/implementation-plan.md) - Canonical phased roadmap + status snapshot + Phase 4 test inventory
  - [Gap Analysis](./windows/gap-analysis.md) - Feature-parity baseline (P0/P1/P2 with file:line refs)
  - [Contributing](./windows/contributing.md) - Branch strategy, commit scope, test expectations, reviewer checklist, **amendment-not-drop discipline**, **test-file split policy**, **`src/main/utils/` tier rules**
  - [Deferred Work](./windows/deferred-work.md) - D1–D8 ledger (Phase 2 review aftermath); [Deferred Work — Phase 4](./windows/deferred-work-phase4.md) - D9–D12 (Phase 4 audit aftermath). Both tracked in #168 (pre-migration reference, does not resolve on the public repo)
  - [Known test flakes](./windows/known-flakes.md) - Windows-host flake register with status, issue link, and remediation-patterns cheat-sheet (fake timers, mocked-fs splits, per-platform e2e budgets, offset-deque)
  - [Whisper Trust Chain](./windows/whisper-trust-chain.md) - **4-layer client-side trust model with composition diagram and attacker model**
  - [Whisper Support Runbook](./windows/whisper-support-runbook.md) - **Operator playbook for Phase 4 error codes** (`WHISPER_MANIFEST_INVALID`, `WHISPER_DOWNGRADE_BLOCKED`, `WHISPER_CPU_UNSUPPORTED`, etc.) with diagnostic trails + stuck-user procedures
  - [Phase 4 binary spec](./windows/phase4-binary-spec.md) - Pinned SHAs for `whisper-build-v1.8.4-erfana2` (and the retired `erfana1`)
  - [Build Setup (Windows)](./build/windows.md) - Node 24, Python 3.12, VS 2022, Developer Mode, long paths
  - [Whisper-binaries CI runbook](./build/whisper-binaries.md) - Ops procedure for self-hosted whisper.cpp rebuilds + cert-revocation + monthly canary + **app-side pin-bump checklist** + **minisign gotchas** + **rejected approaches**
- [Large Project Performance Plan](./large-project-performance-plan.md) - EMFILE mitigation, worker threads, diagnostics, single-flight tree reads (#208), the Windows watcher and exclude list (#211), and the v0.22.0 work: a virtualized project tree, a lazy and parallel tree walk, and content-only saves that skip the tree re-read
- Performance measurements (`performance/`) - how each number was measured, with the raw data and scripts beside each page
  - [Content-only saves no longer re-read the tree](./performance/watcher-structural-refresh.md) - finding [29], v0.22.0
  - [Terminal output batching and flow control](./performance/terminal-output-batching.md) - finding [30], v0.22.0
  - [Typing in a large Markdown file: the deferred preview](./performance/2026-10-21-deferred-preview.md) - finding [31], v0.22.0
  - [Deferred Markdown preview: remembered link checks](./performance/deferred-markdown-preview.md) - finding [31], v0.22.0
  - [Opening a large project: the lazy tree walk](./performance/2026-10-22-lazy-tree-walk.md) - finding [32], v0.22.0
  - [Manual Windows run on a 222k-entry project](./performance/211-large-project-windows-run.md) - #211, W17 (no-exclusion arm)
- Spikes (`spikes/`) - time-boxed findings that a decision rests on
  - [ASAR packaging with integrity enforcement](./spikes/2026-10-22-asar-integrity.md) - the v0.22.0 `app.asar` integrity check
  - [How `fs.watch` behaves on Windows](./spikes/211-windows-fs-watch.md) - #211, W0
  - [What the #138 capture design assumes](./spikes/138-capture-spike.md) - user-guide screenshots
  - [Posting review verdicts without a model Bash call](./spikes/172-verdict-posting.md) - Xezar pipeline, #172
  - [Leader liveness and a 30-minute silence alert](./spikes/179-leader-liveness.md) - Xezar pipeline, #179
- [Leader-silence alert runbook](./runbooks/leader-watch.md) - the macOS notification when the Xezar project leader goes quiet (#179)
- [Testing](./testing/README.md) - Testing strategies and coverage
  - [E2E Testing](./testing/e2e-testing.md) - Playwright/Electron E2E guide
  - [E2E Selectors](./testing/e2e-selectors.md) - `data-testid` catalog (`testids.ts` is the source of truth)
  - [Test Scenarios](./testing/test-scenarios.md) - Manual/MCP visual test scenarios
  - [E2E Helpers](./testing/e2e-helpers.md) - Test utility functions
  - [E2E Third-Party](./testing/e2e-third-party.md) - Monaco, xterm.js, Mermaid patterns
  - [E2E Debugging](./testing/e2e-debugging.md) - Debugging and CI/CD
  - [E2E Troubleshooting](./testing/e2e-troubleshooting.md) - Common issues and fixes
  - [E2E Lessons Learned](./testing/e2e-lessons-learned.md) - Hard-won testing insights
  - [Quick Checks](./testing/quick-checks.md) - Minimal Terminal/Watcher smoke checks
- [EPIPE Error Handling](./epipe-error-handling.md) - Console output error prevention

### Troubleshooting
- [Known Issues](./known-issues.md) - Current limitations and workarounds
- [Troubleshooting](./troubleshooting.md) - Common problems and solutions
- [Advanced Troubleshooting](./troubleshooting-advanced.md) - Deep debugging techniques

### Claude Code Integration
- [GitHub Issues Protocol](./claude-code/github-issues-protocol.md) - When/how Claude Code uses `gh` CLI for issues

### Technical Details
- [HTML Rendering](./rendering/README.md) - Markdown to HTML conversion architecture

### Design records and plans

Not to be confused with **[`docs/design-system/`](design-system/index.html)**, which is the design system. All design *notes* live in `docs/designs/`. They mix three file-naming conventions (`<issue>-<slug>.md`, `issue-<issue>-<slug>.md` and the older `design-issue-<n>.md`), because two folders were merged into one; spec design notes use `sd-<spec>-<slug>.md`.

- [Packaging guards for `extraFiles` / `extraResources`](./designs/design-issue-55.md) - Build-time leak guards beyond the `files:` allowlist (issue #55)
- [Renderer crash on very large projects](./designs/design-issue-60.md) - `flattenTree` stack overflow, error containment (root + panel boundaries), crash trail (issue #60)
- [Multi-page HTML preview](./designs/design-issue-124.md) - Frames, same-tab links with history, and Open in default browser (issue #124)
  - [Part 1: the preview stays inside its panel](./designs/design-issue-124-part1.md)
  - [Part 2: frames show pages from the same project](./designs/design-issue-124-part2.md)
  - [Part 3: links can open in the same tab](./designs/design-issue-124-part3.md)
  - [Part 4: open in default browser](./designs/design-issue-124-part4.md)
  - [Phase 5 as built – deviations log](./designs/design-issue-124-impl.md)
  - [Planned files](./designs/design-issue-124-files.md) and [planned files, G6 and G7](./designs/design-issue-124-files-g6g7.md)
- [Claude Code status bar](./designs/216-claude-status-bar.md) - Per-terminal context status bar design (issue #216; Windows follow-up #217)
- [Model capability registry](./designs/41-model-capability-registry.md) - Shared model-id parser + context-window capability table (issue #41)
- [Context-meter freeze after compaction](./designs/47-context-meter-freeze.md) - Bounded fallback read + per-file-version result cache (issue #47)
- [Clipboard service](./designs/issue-203-clipboard-service.md) - Central text-clipboard service design (issue #203)
- [Large projects on Windows](./designs/211-large-project-windows-watcher.md) - Native Windows directory watcher, the `files.exclude` list, and the watcher starting after the first tree read (issue #211); measured in the [W0 spike on `fs.watch`](./spikes/211-windows-fs-watch.md) and the [W17 manual Windows run](./performance/211-large-project-windows-run.md) (no-exclusion arm; the with-exclusion arm is pending)
- [`http://` and IPv6 in the preview](./designs/108-http-and-ipv6-in-the-preview.md) - What Chromium does with `http://` and IPv6 hosts in the HTML preview (issue #108)
- [Illustrated user guide](./designs/138-user-guide/README.md) - Guide outline, screenshot list, demo project and capture script (issue #138, proposed); [feature inventory](./user-guide/feature-inventory.md), [research](./designs/138-user-guide/research.md), [spec and plan](./features/138-user-guide.md)
- [README and GitHub presentation](./designs/139-readme-redesign/README.md) - Banner, demo loop, page structure and fact audit for the README redesign (issue #139)
- [HTML preview with CSS and JavaScript](./designs/sd-074-html-preview.md) - Sealed-box live preview that runs a project's real CSS and JavaScript (spec 074, issue #74)
- [Preview link navigation and multiple views](./designs/sd-074b-preview-navigation-and-multiview.md) - In-page link navigation and independent preview tabs (spec 074; superseded in part by #124)

### Future Features (Planned)
- [Graph Engine](./future/graph-engine.md) – SQLite + vec + FTS5 knowledge graph (not yet implemented). The full specification lives in [`future/graph-engine/`](./future/graph-engine/), covering the data model, embeddings, hybrid search, MCP server, packaging and performance, plus a milestone-by-milestone [implementation guide](./future/graph-engine/implementation-guide/) and [wireframes](./future/graph-engine/wireframes/). The `architecture-overview`, `data-model`, `packaging` and `implementation-guide/m1-backend` pages there are **superseded for M1** by SD-021 below
- [Graph engine R1 design set (SD-021/#21)](designs/sd-021-graph-architecture.md) – **frozen contracts, nothing wired up.** #21 shipped the M1 architecture (8 parts), spec errata E1–E10, a spike harness and contract code that typechecks but creates no database, spawns no worker, registers no IPC handler and renders no UI. #22–#32 implement against it. Index in [§0](designs/sd-021-graph-architecture.md#0-document-set); the scope invariant ("no PR under #21 changes observable runtime behaviour") is [§2.1](designs/sd-021-graph-architecture.md#21-the-invariant)
- [WAL concurrency spike findings](./graph/wal-concurrency-spike.md) – the C1–C9 contract measurements behind SD-021 §3.2, re-expressed as assertions in `scripts/spikes/graph-wal-concurrency.test.mjs` so the numbers are falsifiable in CI (#21)
- [Native dependencies spike findings](./graph/native-dependencies.md) – better-sqlite3 13 + MCP SDK de-risking results (SD-019/#19); input to the graph DB layer (#23) and MCP server (#30)
- [Save/watch → index pipeline analysis](../specs/spec-t4-004-graph-foundation/analysis/20-save-watch-index-pipeline.md) – reconciles spec-004's illustrative file-event API onto the real watcher/save/project-switch surfaces; event→action mapping consumed by the indexing issues (#25/#32) (#20)
- [Source Grounding](./future/source-grounding/README.md) – NotebookLM-style source grounding research for audit document generation

## Quick Start

**New to the project?** Start with [Getting Started](./getting-started.md), then browse [Quick Reference](./quick-reference.md) and [Glossary](./glossary.md).

**Building features?** Read [Architecture](./architecture.md) → pick your area (Editor, Terminal, etc.) → review [IPC Patterns](./ipc-patterns.md) and, for anything with a UI, the [design system](design-system/index.html).

**Testing?** Run `npm run test` for unit tests, `npm run test:e2e` for E2E tests. See [Testing](./testing/README.md) for strategies.

**Stuck?** Check [Known Issues](./known-issues.md) → [Troubleshooting](./troubleshooting.md) → [E2E Troubleshooting](./testing/e2e-troubleshooting.md).

## Changelog

- [CHANGELOG](./CHANGELOG.md) – Per-version release notes (v0.9.0 onward; v0.8.x and v0.3–v0.5 in the [Archive](#archive); v0.6.x–v0.7.x have no entries). Latest release: v0.22.0 (2026-10-25), which also ships the never-released 0.21.0 changes
- [Changelog fragments](../changelog.d/README.md) – where a pull request records its change instead of editing the changelog; folded into the changelog at release
- [Release notes](./release-notes/README.md) – Per-version release-notes files used as GitHub release bodies (v0.9.5 onward)
- [Release incidents](./release-incidents/index.md) – Running log of `release.yml` failures with matched signatures and fixes

## Archive

Archived documentation was removed from the tree on 2026-10-25. It stays in git history, at these links:
- [Resolved Issues](https://github.com/qodeca/erfana/blob/1d814e05d98b3005e5c13c0624b09653708136f7/docs/archive/resolved-issues.md) – Issues fixed in past versions
- [Changelog v0.3–v0.5](https://github.com/qodeca/erfana/blob/1d814e05d98b3005e5c13c0624b09653708136f7/docs/archive/changelog-v03-v05.md) – Historical changelog entries
- [Changelog v0.8.x](https://github.com/qodeca/erfana/blob/1d814e05d98b3005e5c13c0624b09653708136f7/docs/archive/changelog-v08.md) – Historical changelog entries for the v0.8 series
- [Video import fixes (2026-03-07)](https://github.com/qodeca/erfana/blob/1d814e05d98b3005e5c13c0624b09653708136f7/docs/archive/2026-03-07-video-import-fixes.md) – Completed implementation plan for video import (#110)
- [Phase 2 closure (2026-04)](https://github.com/qodeca/erfana/blob/1d814e05d98b3005e5c13c0624b09653708136f7/docs/archive/phase2-closure-2026-04.md) – Seven-stream closure plan for Windows enablement Phase 2, archived 2026-08-07

## Folders added by the Xezar pipeline

The pipeline's process documents sit at the repository root: [SDLC.md](../SDLC.md) (how work moves), [AGENTS.md](../AGENTS.md) (what every agent runs), [CODE_REVIEW.md](../CODE_REVIEW.md) and [BACKWARD_COMPATIBILITY.md](../BACKWARD_COMPATIBILITY.md). New pipeline designs go in `designs/<feature>/`; the single-file notes already in `designs/` stay as they are.

A folder appears when its first document does, so some of these do not exist yet.

| Path | What lands there | Who it is for |
|---|---|---|
| `designs/` | one folder per designed feature, and the [index](designs/README.md) | whoever builds or reviews a screen |
| `adrs/` | decision records and architecture pages (shared with the records above) | anyone about to reverse a choice |
| `spikes/` | the findings page of a spike, never its prototype code | whoever decides after the spike |
| `runbooks/` | what to do when an alert fires, how a release is rolled back | whoever is on call |
| `deprecations/` | what goes, its replacement, the dates | callers of what goes |
| `performance/` | how a number was measured, and the baselines | whoever changes a hot path |
| `migrations/` | one page per schema, data or format move, with a `reversibility:` line | whoever runs or reviews the move |

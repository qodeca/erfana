# ERFANA Documentation

## Overview
ERFANA is an Electron-based IDE focused on markdown editing with integrated terminal and project management.

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
- [Error Codes](./error-codes.md) - Project-wide `ErrorCode` enum index (~100 codes grouped by category; operator actions for the most-visible ones)
- [Architecture Decision Records](./adrs/README.md) - Durable rationale for load-bearing design choices (ADR 0001 self-host whisper, 0002 minisign, 0003 dual-pubkey, 0004 TOCTOU close)
- [Technical Debt](./technical-debt.md) - Technical debt tracking and priorities

### Feature Documentation
- [Editor](./editor/README.md) - Monaco editor, markdown preview, scroll sync, Mermaid diagrams (full-screen viewer), PDF/DOCX export
- [Image Viewer](./ui-components.md#image-viewer-panel) - Image preview panel with zoom, pan, and fullscreen
- [Terminal](./terminal/README.md) - xterm.js terminal integration
  - [Bootstrap Pattern](./terminal/bootstrap-pattern.md) - Clean initialization without artifacts
  - [Scroll Fixes](./terminal/scroll-fixes.md) - v0.3.1 scroll preservation and scroll to bottom button
  - [Flickering Prevention](./terminal/flickering-prevention.md) - v0.3.2 rendering stability fixes
  - [Troubleshooting](./terminal/troubleshooting.md) - Known issues and solutions
- [Project Panel](./project-panel.md) - File explorer and project management
- [Drag-Drop](./drag-drop/README.md) - VS Code-style file reorganization, external file drop, keyboard shortcuts
- [File Watching](./file-watching/README.md) - Auto-refresh and file monitoring
  - [Patterns & Testing](./file-watching/patterns-and-testing.md) - Implementation patterns and test scenarios
  - [Technical Details](./file-watching/technical-details.md) - Performance, security, edge cases
- [Prompt Templates](./prompts/README.md) - AI-powered text operations (v0.3.4)
  - [AutoExecute Overview](./prompts/autoexecute-overview.md) - Feature overview and architecture
  - [AutoExecute Technical](./prompts/autoexecute-technical.md) - Write pipeline and 200ms delay rationale
  - [AutoExecute Testing](./prompts/autoexecute-testing.md) - Test coverage and mocking strategy
  - [AutoExecute Reference](./prompts/autoexecute-reference.md) - Implementation files and error handling
- [Logging](./logging.md) - Logging layer, log levels, file rotation, settings
- [Settings](./settings.md) - Editor, git, logging, and transcription configuration

### UI/UX
- [UI Style Guide](./ui-style-guide.md) - Design tokens, colors, typography (MANDATORY for UI changes)
- [UI Style Guide Reference](./ui-style-guide-reference.md) - Quick reference for design tokens
- [UI Components](./ui-components.md) - React component architecture
- [Keyboard Shortcuts](./keyboard-shortcuts.md) - Application keyboard shortcuts

### Development
- [Development Tasks](./development-tasks.md) - Build, test, and deployment
- [Continuous Integration](./ci.md) - GitHub Actions workflows (`checks.yml` active on every push; `e2e.yml` **disabled** since 2026-04-25 — local-only verification until macos-latest stability is fixed; `release.yml` and `whisper-binaries*.yml` for release flow), retry patterns, visual-on-CI gap
- [Build](./build/README.md) - electron-builder, ASAR, fuses, troubleshooting
- [Windows Enablement](./windows/README.md) - Phases 0–2 shipped in v0.9.3; Phase 4 (local Whisper trust chain + Windows x64 binary) shipped in [v0.9.4](https://github.com/qodeca/erfana/releases/tag/v0.9.4) on 2026-04-23 per [#165](https://github.com/qodeca/erfana/issues/165); Windows-host test-flake remediation pool ([#172](https://github.com/qodeca/erfana/issues/172)) + ThrottledWorker offset-deque refactor ([#173](https://github.com/qodeca/erfana/issues/173)) also in v0.9.4; Phase 3 (screenshots, [#164](https://github.com/qodeca/erfana/issues/164)) unstarted; Phases 5–6 tracked under [#166–#167](https://github.com/qodeca/erfana/issues?q=label%3Awindows)
  - [Implementation Plan](./windows/implementation-plan.md) - Canonical phased roadmap + status snapshot + Phase 4 test inventory
  - [Gap Analysis](./windows/gap-analysis.md) - Feature-parity baseline (P0/P1/P2 with file:line refs)
  - [Contributing](./windows/contributing.md) - Branch strategy, commit scope, test expectations, reviewer checklist, **amendment-not-drop discipline**, **test-file split policy**, **`src/main/utils/` tier rules**
  - [Deferred Work](./windows/deferred-work.md) - D1–D8 ledger (Phase 2 review aftermath); [Deferred Work — Phase 4](./windows/deferred-work-phase4.md) - D9–D12 (Phase 4 audit aftermath). Both tracked in [#168](https://github.com/qodeca/erfana/issues/168)
  - [Known test flakes](./windows/known-flakes.md) - Windows-host flake register with status, issue link, and remediation-patterns cheat-sheet (fake timers, mocked-fs splits, per-platform e2e budgets, offset-deque)
  - [Whisper Trust Chain](./windows/whisper-trust-chain.md) - **4-layer client-side trust model with composition diagram and attacker model**
  - [Whisper Support Runbook](./windows/whisper-support-runbook.md) - **Operator playbook for Phase 4 error codes** (`WHISPER_MANIFEST_INVALID`, `WHISPER_DOWNGRADE_BLOCKED`, `WHISPER_CPU_UNSUPPORTED`, etc.) with diagnostic trails + stuck-user procedures
  - [Phase 4 binary spec](./windows/phase4-binary-spec.md) - Pinned SHAs for `whisper-build-v1.8.4-erfana1`
  - [Phase 2 Closure](./windows/phase2-closure.md) - 7-stream closure plan (write-once-archive)
  - [Build Setup (Windows)](./build/windows.md) - Node 24, Python 3.12, VS 2022, Developer Mode, long paths
  - [Whisper-binaries CI runbook](./build/whisper-binaries.md) - Ops procedure for self-hosted whisper.cpp rebuilds + cert-revocation + monthly canary + **app-side pin-bump checklist** + **minisign gotchas** + **rejected approaches**
- [Large Project Performance Plan](./large-project-performance-plan.md) - EMFILE mitigation, worker threads, diagnostics
- [Testing](./testing/README.md) - Testing strategies and coverage
  - [E2E Testing](./testing/e2e-testing.md) - Playwright/Electron E2E guide
  - [E2E Selectors](./testing/e2e-selectors.md) - 225 testids catalog
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

### Architecture Reviews
- [Code Review – Drag-Drop](./architecture-reviews/code-review-drag-drop-2025-01.md) - Drag-drop refactoring review
- [Markdown Editor Panel Refactoring](./architecture-reviews/reviews/markdown-editor-panel-refactoring-review.md) - Editor panel architecture review
- [Terminal Panel Architecture](./architecture-reviews/reviews/terminal-panel-architecture-review.md) - Terminal panel design review

### Future Features (Planned)
- [Graph Engine](./future/graph-engine.md) – SQLite + vec + FTS5 knowledge graph (not yet implemented)
- [Source Grounding](./future/source-grounding/README.md) – NotebookLM-style source grounding research for audit document generation

## Quick Start

**New to the project?** Start with [Getting Started](./getting-started.md), then browse [Quick Reference](./quick-reference.md) and [Glossary](./glossary.md).

**Building features?** Read [Architecture](./architecture.md) → pick your area (Editor, Terminal, etc.) → review [IPC Patterns](./ipc-patterns.md) and [UI Style Guide](./ui-style-guide.md).

**Testing?** Run `npm run test` for unit tests, `npm run test:e2e` for E2E tests. See [Testing](./testing/README.md) for strategies.

**Stuck?** Check [Known Issues](./known-issues.md) → [Troubleshooting](./troubleshooting.md) → [E2E Troubleshooting](./testing/e2e-troubleshooting.md).

## Changelog

- [CHANGELOG](./CHANGELOG.md) – Per-version release notes (v0.6.0 onward; earlier in archive)

## Archive

Archived documentation is located in [`./archive/`](./archive/):
- [Resolved Issues](./archive/resolved-issues.md) – Issues fixed in past versions
- [Changelog v0.3–v0.5](./archive/changelog-v03-v05.md) – Historical changelog entries

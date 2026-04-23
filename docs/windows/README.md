# Windows enablement

This folder tracks the work to bring Erfana to full Windows parity with macOS.

## Quick start for a new session

1. **Read the [implementation plan](implementation-plan.md) "Status snapshot"** section — canonical current state.
2. **Branch strategy**: Phases 0–2 shipped in v0.9.3 on `develop`. **Phase 4 (local Whisper) merged to `develop` on 2026-04-23 (`110f1b9`) for 0.9.4** — self-hosted whisper.cpp binary workflow + full client-side trust chain + D12-resolved test rewrite + post-merge `faaee61` (archive-format chmod gate + `.gitattributes` for LF-pinned fixtures). Phase 3 + Phases 5–6 use their own `feature/windows-phase-<N>-*` branches off `develop`. The historical `windows` integration branch was deleted after the 2026-04-22 merge.
3. **On Windows host**: ensure Developer Mode + long-paths enabled per [`docs/build/windows.md`](../build/windows.md) steps 4–5.
4. **Check open issues**: `gh issue list --repo qodeca/erfana --label windows --state open`.

## First commands per host

```bash
# Windows 11 host (PowerShell or Git Bash)
npm install
npm run test:main        # 243 files / ~7887 tests baseline (Phase-2 UAT added 60 bootstrap tests)
npm run dev              # smoke-test Electron + terminal

# macOS host (regression check for cross-platform changes)
npm install
npm run test:cov         # all 3 projects with coverage
npm run build:mac        # produces .dmg
```

See [`contributing.md`](contributing.md) for the full pre-PR test matrix.

## Context

Erfana (v0.9.3, Electron 39) now ships with first-class Windows support for Phases 0–2: the dev loop, terminal parity, file-ops safety (reserved-filename guard), git-status discovery, and LibreOffice-backed DOCX import all work on Windows 11 Pro. The codebase started with partial Windows awareness — `CmdOrCtrl` accelerators, case-insensitive path folding in `ProjectService.ts`, `where`/`which` switching in the git worker, PowerShell shell selection in `TerminalService`, NSIS target in `electron-builder.yml`, `ffmpeg-static` (Windows binary), cross-platform chokidar config in `PlatformConfig.ts` — but several gaps were **hard blockers**, and a handful of "looks handled" areas were silently broken or dead code. Those blockers were resolved in v0.9.3.

The goal is **full Windows parity** — every feature that works on macOS must work on Windows, including local Whisper transcription and screen capture. **Phase 4 closed the local-Whisper gap for both macOS and Windows x64** (the pre-Phase-4 macOS path was also broken — ggml-org never published a macOS CLI binary; Phase 4 self-hosts both). Phase 3 (screenshots) and Phases 5–6 (distribution/signing/auto-update/polish) close the remaining gaps.

## Documents

| File | Purpose |
|------|---------|
| [`implementation-plan.md`](implementation-plan.md) | **Canonical status + phased roadmap** (Phase 0–6) with current state snapshot, per-feature Windows status, execution order, and multi-session cross-platform workflow guidance. |
| [`gap-analysis.md`](gap-analysis.md) | Verified inventory of every Windows-related gap, grouped by severity (P0/P1/P2) with file:line references. |
| [`contributing.md`](contributing.md) | Contributor workflow for Windows parity work – branch strategy, issue labels, commit scope, test expectations, reviewer checklist. |
| [`deferred-work.md`](deferred-work.md) | D1–D8 deferred items (Phase 2 review aftermath) with severity, promotion criteria, risk-if-forgotten. |
| [`deferred-work-phase4.md`](deferred-work-phase4.md) | D9–D12 deferred items (Phase 4 audit aftermath). Same template as D1-D8; split for file-size compliance (500-line cap). |
| [`known-flakes.md`](known-flakes.md) | Windows test-flake remediation register — symptom, status, issue link per test. Includes remediation patterns cheat-sheet and follow-up audit candidates. |
| [`phase4-binary-spec.md`](phase4-binary-spec.md) | Pinned SHAs for the first published `whisper-build-v1.8.4-erfana1` release (source-of-truth cross-checked against `src/main/services/whisper-assets.ts`). |
| [`phase2-closure.md`](phase2-closure.md) | Historical 7-stream closure plan for Phase 2 — write-once-archive, retained for reference. |
| [`../build/windows.md`](../build/windows.md) | Windows dev environment setup (Node 24, Python 3.12, VS 2022 Build Tools, Developer Mode, long paths, troubleshooting, contributor expectations). |
| [`../build/whisper-binaries.md`](../build/whisper-binaries.md) | Ops runbook for Phase 4 self-hosted whisper.cpp rebuilds: rebuild procedure, upstream SHA diff-review, cert-revocation sub-runbooks, scheduled canary, retention policy, quarterly integrity task, cost model. |

## Status

**Canonical status snapshot:** [`implementation-plan.md` § Status snapshot](implementation-plan.md#status-snapshot) — per-phase verification, shipped features, and remaining work all live there. This file covers the document map + onboarding only.

**One-line current state (2026-04-23):** Phases 0, 1, 2 shipped in **v0.9.3** (merged from `windows` → `develop` on 2026-04-22). **Phase 4 (local Whisper, [#165](https://github.com/qodeca/erfana/issues/165)) merged to `develop` on 2026-04-23 (`110f1b9`) for 0.9.4** — B1+B2+B2c trust chain, B3 UI gate, B4 docs, B5a-f audit-gap closure, D12 test rewrite, plus post-merge `faaee61` CI stability fix. Windows-host test-flake remediation pool ([#172](https://github.com/qodeca/erfana/issues/172)) + ThrottledWorker offset-deque refactor ([#173](https://github.com/qodeca/erfana/issues/173)) also merged 2026-04-23 (`c3cc005`). Phase 3 (screenshots, [#164](https://github.com/qodeca/erfana/issues/164)) + Phases 5–6 ([#166](https://github.com/qodeca/erfana/issues/166) / [#167](https://github.com/qodeca/erfana/issues/167)) unstarted. Deferred items D1–D12 → [#168](https://github.com/qodeca/erfana/issues/168) (D12 resolved 2026-04-23). Dependabot triage → [#169](https://github.com/qodeca/erfana/issues/169).

## How the analysis was produced

- Two parallel code-exploration agents covered the main process, renderer, tests, CI, build config, and docs.
- All highest-stakes findings (the ones marked "verified" in the gap analysis) were confirmed by direct file reads. Findings not directly re-verified are marked `(inferred)`.
- The plan's sequencing is driven by one principle: fix the developer loop first (Phase 0), because every downstream blocker is speculative until a Windows contributor can run `npm install` and `npm run dev`.

## Out of scope for the first pass

- GitHub Actions `windows-latest` CI matrix (originally deferred; now folded into Phase 6 alongside visual baselines).
- MSIX / AppX / Microsoft Store distribution.
- Windows ARM64 native builds.
- Linux parity gaps (tracked separately).

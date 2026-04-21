# Windows enablement

This folder tracks the work to bring Erfana to full Windows parity with macOS.

## Quick start for a new session

1. **Read the [implementation plan](implementation-plan.md) "Status snapshot"** section — canonical current state.
2. **Check your branch**: Windows work lives on `windows` (integration branch). `git fetch && git status` first.
3. **On Windows host**: ensure Developer Mode + long-paths enabled per [`docs/build/windows.md`](../build/windows.md) steps 4–5.
4. **Check open issues**: `gh issue list --repo qodeca/erfana --label windows --state open`.

## Context

Erfana (v0.9.2, Electron 39) is macOS-first with partial Windows awareness. The codebase already had genuine Windows hooks in several places — `CmdOrCtrl` accelerators, case-insensitive path folding in `ProjectService.ts`, `where`/`which` switching in the git worker, PowerShell shell selection in `TerminalService`, NSIS target in `electron-builder.yml`, `ffmpeg-static` (Windows binary), cross-platform chokidar config in `PlatformConfig.ts` — but several gaps were **hard blockers**, and a handful of "looks handled" areas were silently broken or dead code.

The goal is **full Windows parity** — every feature that works on macOS must work on Windows, including local Whisper transcription and screen capture.

## Documents

| File | Purpose |
|------|---------|
| [`implementation-plan.md`](implementation-plan.md) | **Canonical status + phased roadmap** (Phase 0–6) with current state snapshot, per-feature Windows status, execution order, and multi-session cross-platform workflow guidance. |
| [`gap-analysis.md`](gap-analysis.md) | Verified inventory of every Windows-related gap, grouped by severity (P0/P1/P2) with file:line references. |
| [`contributing.md`](contributing.md) | Contributor workflow for Windows parity work – branch strategy, issue labels, commit scope, test expectations, reviewer checklist. |
| [`../build/windows.md`](../build/windows.md) | Windows dev environment setup (Node 24, Python 3.12, VS 2022 Build Tools, Developer Mode, long paths, troubleshooting, contributor expectations). |

## Status

**Canonical status snapshot:** [`implementation-plan.md` § Status snapshot](implementation-plan.md#status-snapshot-last-updated-2026-04-21-v092-base) — recent commits, per-phase verification, merge-readiness gate, all live there. This file covers the document map + onboarding only.

**One-line current state (2026-04-21):** Phases 0, 1, 2 closed on `windows` branch; awaits `windows → develop` merge gated on Phase 1 manual UAT. Phases 3–6 tracked under [#164](https://github.com/qodeca/erfana/issues/164) / [#165](https://github.com/qodeca/erfana/issues/165) / [#166](https://github.com/qodeca/erfana/issues/166) / [#167](https://github.com/qodeca/erfana/issues/167). Deferred items D1–D8 → [#168](https://github.com/qodeca/erfana/issues/168). Dependabot triage → [#169](https://github.com/qodeca/erfana/issues/169).

## How the analysis was produced

- Two parallel code-exploration agents covered the main process, renderer, tests, CI, build config, and docs.
- All highest-stakes findings (the ones marked "verified" in the gap analysis) were confirmed by direct file reads. Findings not directly re-verified are marked `(inferred)`.
- The plan's sequencing is driven by one principle: fix the developer loop first (Phase 0), because every downstream blocker is speculative until a Windows contributor can run `npm install` and `npm run dev`.

## Out of scope for the first pass

- GitHub Actions `windows-latest` CI matrix (originally deferred; now folded into Phase 6 alongside visual baselines).
- MSIX / AppX / Microsoft Store distribution.
- Windows ARM64 native builds.
- Linux parity gaps (tracked separately).

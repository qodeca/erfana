# Windows enablement

This folder tracks the work to bring Erfana to full Windows parity with macOS.

## Context

Erfana (v0.9.1, Electron 39) is macOS-first with partial Windows awareness. The codebase already has genuine Windows hooks in several places — `CmdOrCtrl` accelerators, case-insensitive path folding in `ProjectService.ts`, `where`/`which` switching in the git worker, PowerShell shell selection in `TerminalService`, NSIS target in `electron-builder.yml`, `ffmpeg-static` (Windows binary), cross-platform chokidar config in `PlatformConfig.ts` — but several gaps are **hard blockers**, and a handful of "looks handled" areas are silently broken or dead code.

The goal is **full Windows parity** — every feature that works on macOS must work on Windows, including local Whisper transcription and screen capture.

**Out of scope for the first pass:** GitHub Actions `windows-latest` CI matrix. Manual validation on a Windows 11 box is the verification bar for this iteration.

## Documents

| File | Purpose |
|------|---------|
| [`gap-analysis.md`](gap-analysis.md) | Verified inventory of every Windows-related gap, grouped by severity (P0/P1/P2) with file:line references. |
| [`implementation-plan.md`](implementation-plan.md) | Phased roadmap (Phase 0–6) with concrete changes, reused utilities, and a manual verification checklist. |

## How the analysis was produced

- Two parallel code-exploration agents covered the main process, renderer, tests, CI, build config, and docs.
- All highest-stakes findings (the ones marked "verified" in the gap analysis) were confirmed by direct file reads. Findings not directly re-verified are marked `(inferred)`.
- The plan's sequencing is driven by one principle: fix the developer loop first (Phase 0), because every downstream blocker is speculative until a Windows contributor can run `npm install` and `npm run dev`.

## Status

Initial analysis and plan: **2026-04-08**. Implementation not yet started.

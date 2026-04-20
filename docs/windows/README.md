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
| [`../build/windows.md`](../build/windows.md) | Windows dev environment setup (Node 24, Python 3.12, VS 2022 Build Tools, Developer Mode, long paths, troubleshooting, contributor expectations). |

## Status (as of 2026-04-20)

| Phase | Scope | Issue | Status |
|-------|-------|-------|--------|
| **Phase 0** — Unblock Windows dev loop | Portable scripts, prerequisites docs, test path portability, setJumpList mock, SearchBar fix, NSIS smoke | [#153](https://github.com/qodeca/erfana/issues/153) | ✅ **Closed 2026-04-20** — all 5 ACs met; macOS regression verified |
| **Phase 1** — Terminal parity | cmd.exe bootstrap, PowerShell `-LiteralPath`, shell fallback chain, cwd validation, `WindowsBootstrapBuilder` strategy | [#154](https://github.com/qodeca/erfana/issues/154) | **Landed**; manual UAT pending on Windows host |
| Phase 2 — File ops, deps, filenames, long paths | Git allowlist, reserved filename guard, LibreOffice detection, long-path activation | [#155](https://github.com/qodeca/erfana/issues/155) (umbrella) | **Open** — split into #155a–d sub-issues per 2026-04-20 plan |
| Phase 3 — Screenshot parity | `desktopCapturer` strategy + area-selection overlay | _not yet filed_ | Pending |
| Phase 4 — Local Whisper parity | `getArchSuffix()` cross-platform, Windows binary layout | _not yet filed_ | Pending |
| Phase 5 — Distribution hygiene | Auto-update URL, code signing, NSIS tweaks | _not yet filed_ | Pending |
| Phase 6 — Polish & DX | Platform detection migration, Camera verification, known-issues doc, visual baselines, Windows CI guard, #158 v8 coverage fix | _not yet filed_ | Pending |

### Closed issues contributing to Phase 0

| Issue | Description | Resolution |
|---|---|---|
| [#156](https://github.com/qodeca/erfana/issues/156) | `app.setJumpList` mock missing in `index.test.ts` | Landed in `54e8300` (`ebc3088` merge) |
| [#157](https://github.com/qodeca/erfana/issues/157) | Hardcoded Unix paths in 20+ main-process tests | Landed in `75877a8` (`3196314` merge) |

### New issues filed during Phase 0

| Issue | Description | Priority |
|---|---|---|
| [#158](https://github.com/qodeca/erfana/issues/158) | v8 coverage provider ENOENT race in `test:cov` on Windows | Deferred to Phase 6 |
| [#159](https://github.com/qodeca/erfana/issues/159) | `CameraDialog.test.tsx` teardown timer → vitest exit-1 (all tests pass) | Non-blocking test fix |

Phases 1 and 2 can run in parallel. Phase 2 sub-issues (#155a–d) are independent and can be worked in any order — recommended priority: #155b (git allowlist) → #155c (filename guard) → #155a (LibreOffice) → #155d (long paths).

## How the analysis was produced

- Two parallel code-exploration agents covered the main process, renderer, tests, CI, build config, and docs.
- All highest-stakes findings (the ones marked "verified" in the gap analysis) were confirmed by direct file reads. Findings not directly re-verified are marked `(inferred)`.
- The plan's sequencing is driven by one principle: fix the developer loop first (Phase 0), because every downstream blocker is speculative until a Windows contributor can run `npm install` and `npm run dev`.

## Out of scope for the first pass

- GitHub Actions `windows-latest` CI matrix (originally deferred; now folded into Phase 6 alongside visual baselines).
- MSIX / AppX / Microsoft Store distribution.
- Windows ARM64 native builds.
- Linux parity gaps (tracked separately).

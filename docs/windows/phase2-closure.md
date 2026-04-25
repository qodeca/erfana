# Phase 2 closure plan

> **Lifecycle**: Write-once-archive. This document captures the closure plan for Phase 2 of the Windows enablement roadmap. Move to `docs/archive/` once Phase 3 (#164) opens, since the closure work is then historical.

## Context

Phase 2 implementation completed on the `windows` branch on 2026-04-21 and **shipped to `develop` in v0.9.3 on 2026-04-22** (merge commit `c1e085d`, release `0b593a1`). All four sub-issues landed: #160 (git allowlist + liveness), #161 (reserved-filename guard with bidi-override defence), #162 (LibreOffice Windows detection + liveness), #163 (long-path activation deferred to Phase 6 with promotion criteria). The 4-reviewer audit is complete; shared `flakeGuard.ts` deployed; 23+ consecutive clean `test:renderer` runs since. The historical merge-readiness gate snapshot lives at [`implementation-plan.md` § Merge-to-develop readiness](implementation-plan.md#merge-to-develop-readiness-historical--gate-satisfied-2026-04-22).

## Streams (A–G)

### Stream A – User-only validation ✅ DONE

#### A1. Phase 1 manual UAT on Windows host ✅
Four checklist items (shell cwd, cmd.exe force, Ctrl+C interrupt, ampersand path error) verified during the 2026-04-21 Phase-2 UAT session on Windows 11 Pro. UAT surfaced three additional hardening items (Git Bash builder, ConPTY reflow clear, `Program Files (x86)` deny-list relax), all fixed in `c8543bf` before merge.

#### A2. macOS regression check ✅
`npm run test:cov` + `npm run build:mac` clean on macOS; 7887 tests / 244 files / 0 failures; both DMGs produced.

### Stream B – Code & docs cleanup ✅ DONE
- B1: Renumber `#155b/c/a/d` → `#160/161/162/163` in [`implementation-plan.md:212-230`](implementation-plan.md); convert "Decision (2026-04-20)" block to past-tense (commit `0ab61ef`).
- B2: Last-mile test sweep (`npm run typecheck`, `test:main`, `test:renderer`, `test:preload`).
- B3: Document pre-existing lint baseline (`LocalWhisperService.test.ts`, `CameraService.test.ts` unused vars + escape regexes) in PR so not blamed on Phase 2.

### Stream C – File Phase 3-6 tracking issues ✅ DONE
- **#164** Phase 3 — Screenshot parity (desktopCapturer + area-select overlay)
- **#165** Phase 4 — Local Whisper Windows binary support
- **#166** Phase 5 — Auto-updater URL, code signing, NSIS tweaks
- **#167** Phase 6 — Polish, Windows CI guard, visual baselines
- **#168** Meta-issue for deferred items D1-D8

### Stream D – Dependabot triage ✅ DONE
- Read each of 6 open PRs (#140–#145) + CI status; categorize by risk.
- Audit 28 security alerts via `gh api`.
- Merge trivial bumps (eslint, type packages, patches); defer risky ones (e.g. chokidar 4→5 major) with explicit PR comment.
- Document outcome in Phase 2 PR description as "known security debt" if deferred.

### Stream E – PR + merge orchestration ✅ DONE
- E1–E4. Merge commit `c1e085d` landed on `develop` 2026-04-22 (merge-commit style, preserves per-issue trail).
- E5. Tag `v0.9.3` created and pushed 2026-04-22 (release commit `0b593a1`).

### Stream F – Post-merge cleanup ✅ DONE
- F1–F2 landed in release commit `0b593a1`: `package.json` bumped 0.9.2 → 0.9.3, CHANGELOG "Unreleased" promoted to `## 0.9.3`.
- F3–F5. Implementation plan, README, root CLAUDE.md updated to "shipped" state (doc-update 2026-04-22).

### Stream G – Branch cleanup ✅ DONE
- G1. `origin/windows` deleted on remote; local `windows` branch removed (confirmed by `git fetch --prune` showing `[deleted] origin/windows`).
- G2. No open PRs target `windows`; Phase 3–6 work uses `feature/windows-phase-<N>-*` branches off `develop`.

## Dependency graph (historical, all streams closed)

```
Stream A (user UAT) ──┐    ✅ done
                      ├──► Stream E (PR+merge)  ──► Stream F (post-merge)  ──► Stream G (branch cleanup)
Stream B (cleanup) ───┤   ✅ done                    ✅ done                     ✅ done
Stream C (issues) ────┤   ✅ done
Stream D (deps) ──────┘   ✅ done
```

All seven streams closed by the v0.9.3 merge + release cycle (2026-04-22).

## Decisions resolved during Phase 2

- **Version**: v0.9.3 patch (not minor) — users could already run on Windows with limitations; this lifts them, doesn't break anyone
- **Merge style**: merge-commit — preserves per-issue commit trail + review findings
- **Dependabot**: triage individually; trivial bumps merge before Phase 2 PR; risky ones defer with comment
- **`windows` branch**: delete after merge; per-phase feature branches (`feature/windows-phase-3-*`) off develop
- **Long-path activation (#163)**: deferred to Phase 6 with promotion criteria recorded at `PlatformConfig.ts:194-201` (comment above `isWindowsLongPath` at `:203`)
- **LibreOffice registry probe (#162)**: deferred unless filesystem probe proves insufficient
- **`INVALID_FILENAME_MARKER` shared constant**: chosen over structured-error IPC serialization (D4 deferred to Phase 6)
- **Bidi regex `u` flag (CRITICAL)**: hex-escape ranges + `u` flag for engine-consistent code-point matching
- **`FileService.createFile` path-strip (HIGH)**: path-traversal fix; sibling methods already had it
- **LibreOffice `--version` liveness probe (HIGH)**: security fix matching #160's git-resolver pattern

## Cross-references

- [`implementation-plan.md`](implementation-plan.md) — canonical Phase 0–6 roadmap, status snapshot, merge-readiness gate
- [`deferred-work.md`](deferred-work.md) — D1–D8 deferred items with promotion criteria
- [`gap-analysis.md`](gap-analysis.md) — verified inventory of every Windows gap with file:line refs
- [`README.md`](README.md) — quick-start for new sessions

## When to archive this file

When Phase 3 (#164) implementation begins, move this file to `docs/archive/phase2-closure-2026-04.md` and update the "Lifecycle" line to "Archived YYYY-MM-DD". Do NOT delete — useful for future phase-closure templates.

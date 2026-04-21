# Phase 2 closure plan

> **Lifecycle**: Write-once-archive. This document captures the closure plan for Phase 2 of the Windows enablement roadmap. Move to `docs/archive/` once Phase 3 (#164) opens, since the closure work is then historical.

## Context

Phase 2 implementation is substantively complete on the `windows` branch as of 2026-04-21. All four sub-issues landed: #160 (git allowlist + liveness), #161 (reserved-filename guard with bidi-override defence), #162 (LibreOffice Windows detection + liveness), #163 (long-path activation deferred to Phase 6 with promotion criteria). The 4-reviewer audit is complete; shared `flakeGuard.ts` deployed; 23+ consecutive clean `test:renderer` runs since. See the merge-readiness gate at [`implementation-plan.md:410-420`](implementation-plan.md) for the authoritative completion criteria.

## Streams (A–G)

### Stream A – User-only validation (blocked on user)

#### A1. Phase 1 manual UAT on Windows host
Source: [`implementation-plan.md:64-68`](implementation-plan.md). Four checklist items (shell cwd, cmd.exe force, Ctrl+C interrupt, ampersand path error); ~15 min. Report pass/fail in PR.

#### A2. macOS regression check
Re-verify Phase 2 changes do not regress macOS: `npm run test:cov` (all 3 projects), `npm run build:mac`, dev smoke-test. Expected: test exit 0, DMGs produced. ~10 min wall clock.

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

### Stream E – PR + merge orchestration (gated on Stream A)
- E1. Draft PR description: scope (Phase 0–2 sub-issues), manual UAT results (A1), macOS regression (A2), known gaps with tracking (Phase 3–6 issues), deferred work (D1–D8 link), security note, pre-existing lint baseline, test results.
- E2. Open PR: `git checkout windows` → `gh pr create --base develop --head windows --title "feat(windows): Phases 0-2 complete…" --body-file <(…)`
- E3. Wait gate: user reviews, UATs if needed, user approves.
- E4. Merge: `gh pr merge <N> --merge` (merge-commit per Q2 decision).
- E5. Tag v0.9.3 (patch, per Q1 decision): `git tag -a v0.9.3 -m "Phase 0-2 Windows enablement: dev loop, terminal parity, file ops"`

### Stream F – Post-merge cleanup (after E4)
- F1. Bump `package.json`: `0.9.2` → `0.9.3`
- F2. Move CHANGELOG "Unreleased" → `## 0.9.3` section, drop "(on `windows` branch)" qualifier
- F3. Update [`implementation-plan.md`](implementation-plan.md): mark Phase 2 shipped v0.9.3, gate all-checked, add merge date/PR
- F4. Update [`README.md`](README.md): Phase 2 row → ✅ Shipped, link to release tag
- F5. Update root `CLAUDE.md`: version reference `0.9.2` → `0.9.3`
- F6. Single commit on develop: `chore(windows): bump to v0.9.3 — Phase 0-2 shipped`

### Stream G – Branch cleanup (after F)
- G1. Delete `windows` branch: `git branch -d windows` + `git push origin --delete windows` (per Q4 decision to use per-phase feature branches off develop, matching project convention).
- G2. Verify: no PRs targeting windows; no outstanding issue references.

## Dependency graph

```
Stream A (user UAT) ──┐
                      ├──► Stream E (PR+merge) ──► Stream F (post-merge) ──► Stream G (branch cleanup)
Stream B (cleanup) ───┤   ✅ done
Stream C (issues) ────┤   ✅ done
Stream D (deps) ──────┘   ✅ done
```

A is the long pole (user Windows + macOS testing). B/C/D run in parallel.

## Decisions resolved during Phase 2

- **Version**: v0.9.3 patch (not minor) — users could already run on Windows with limitations; this lifts them, doesn't break anyone
- **Merge style**: merge-commit — preserves per-issue commit trail + review findings
- **Dependabot**: triage individually; trivial bumps merge before Phase 2 PR; risky ones defer with comment
- **`windows` branch**: delete after merge; per-phase feature branches (`feature/windows-phase-3-*`) off develop
- **Long-path activation (#163)**: deferred to Phase 6 with promotion criteria recorded at `PlatformConfig.ts:172`
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

# Windows enablement

> **Note**: issue and PR numbers, commit SHAs, release tags and CI run links below predate the 2026-06 open-source migration and no longer resolve on `qodeca/erfana`; they are retained as provenance.

This folder tracks the work to bring Erfana to full Windows parity with macOS.

## Quick start for a new session

1. **Read the [implementation plan](implementation-plan.md) "Status snapshot"** section — canonical current state.
2. **Branch strategy**: Phases 0–2 shipped in v0.9.3 on `develop`. **Phase 4 (local Whisper) merged to `develop` on 2026-04-23 (`110f1b9`) for 0.9.4** — self-hosted whisper.cpp binary workflow + full client-side trust chain + D12-resolved test rewrite + post-merge `faaee61` (archive-format chmod gate + `.gitattributes` for LF-pinned fixtures). Phase 3 + Phases 5–6 use their own `feature/windows-phase-<N>-*` branches off `develop`. The historical `windows` integration branch was deleted after the 2026-04-22 merge. Note the repository now carries a third long-lived branch, `graph` — the integration branch for the graph engine (spec 004). It is not a Windows branch; do not base Windows work on it, and do not merge Windows work into it.
3. **On Windows host**: ensure Developer Mode + long-paths enabled per [`docs/build/windows.md`](../build/windows.md) steps 4–5.
4. **Check open issues**: `gh issue list --repo qodeca/erfana --label windows --state open`. The `windows` label exists on the public repository (verified 2026-08-07 via `gh label list`) and is the session-start filter for this folder. Note the numbering restarted at the 2026-06 migration, so pre-migration issue numbers quoted throughout `docs/windows/` will not appear in that list.

## First commands per host

```bash
# Windows 11 host (PowerShell or Git Bash)
npm install
npm run test:main        # baseline drifts per release — see docs/testing/README.md for the current count
npm run dev              # smoke-test Electron + terminal

# macOS host (regression check for cross-platform changes)
npm install
npm run test:cov         # all 3 projects with coverage
npm run build:mac        # produces .dmg
```

See [`contributing.md`](contributing.md) for the full pre-PR test matrix.

## Context

Erfana (v0.18.0, Electron 39) ships with first-class Windows support for Phases 0–4: the dev loop, terminal parity, file-ops safety (reserved-filename guard), git-status discovery, LibreOffice-backed DOCX import, local whisper.cpp transcription (Windows x64), and cross-platform screenshot capture (Phase 3, #164) all work on Windows 11 Pro. The codebase started with partial Windows awareness — `CmdOrCtrl` accelerators, case-insensitive path folding in `ProjectService.ts`, `where`/`which` switching in the git worker, PowerShell shell selection in `TerminalService`, NSIS target in `electron-builder.yml`, `ffmpeg-static` (Windows binary), cross-platform chokidar config in `PlatformConfig.ts` — but several gaps were **hard blockers**, and a handful of "looks handled" areas were silently broken or dead code. Those blockers were resolved in v0.9.3.

The goal is **full Windows parity** — every feature that works on macOS must work on Windows, including local Whisper transcription and screen capture. **Phase 4 closed the local-Whisper gap for both macOS and Windows x64** (the pre-Phase-4 macOS path was also broken — ggml-org never published a macOS CLI binary; Phase 4 self-hosts both). Phase 3 (screenshots) closed the capture gap in v0.12.0, and Phase 6 partially closed the polish gap in v0.13.0. What remains is Phase 5 (NSIS installer UX only — signing already shipped in v0.9.5) and the unreleased Phase 6 item 5 (packaged-build tessdata verification); item 6, the `-win32.png` visual baselines, was completed 2026-09-04 — all six are generated and committed. Auto-update is not on that list: it was removed by decision (`publish: null`), not deferred.

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
| [`whisper-trust-chain.md`](whisper-trust-chain.md) | 4-layer client-side trust model for the local whisper.cpp subprocess — composition diagram, per-layer guarantees, attacker model. |
| [`whisper-support-runbook.md`](whisper-support-runbook.md) | Operator playbook for the `WHISPER_*` error codes — diagnostic trails, log paths, stuck-user procedures. |
| [`../build/windows.md`](../build/windows.md) | Windows dev environment setup (Node 24, Python 3.12 known good – 3.14.3 verified 2026-09-03 on Windows 11 – VS 2022 Build Tools, Developer Mode, long paths, troubleshooting, contributor expectations). |
| [`../build/whisper-binaries.md`](../build/whisper-binaries.md) | Ops runbook for Phase 4 self-hosted whisper.cpp rebuilds: rebuild procedure, upstream SHA diff-review, cert-revocation sub-runbooks, scheduled canary, retention policy, quarterly integrity task, cost model. |

## Status

**Canonical status snapshot:** [`implementation-plan.md` § Status snapshot](implementation-plan.md#status-snapshot) — current state, per-release Windows history, per-phase verification, shipped features and remaining work all live there. Read it from that file, never from here. This file covers the document map + onboarding only.

## Out of scope for the first pass

- ~~GitHub Actions `windows-latest` CI matrix~~ — **now live.** `checks.yml` runs an advisory `windows-checks` job (typecheck + design-sync check + `test:main`) on `windows-latest`; it is not yet a required status check.
- MSIX / AppX / Microsoft Store distribution.
- Windows ARM64 native builds.
- Linux parity gaps (tracked separately).

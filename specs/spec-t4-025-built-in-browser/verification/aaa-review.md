# AAA review – spec 025, built-in browser

This file holds the scoring rubric for the issue #448 definition of done: seven independent reviewers each score the built-in browser from 1 to 10, and each score must be 8 or higher. The rubric is committed before any reviewer runs, so the bar cannot move after the scores are known. Scores and evidence are added below the rubric; the rubric itself does not change after this commit.

## Rules for every reviewer

- The reviewer did not write the code and runs as a separate agent.
- The reviewer reads the code, the tests and the spec itself. A summary from the lead is context, never evidence.
- Every score cites evidence: `file:line`, a command and its output, or a test name. A claim without evidence does not count toward the score.
- Each finding has a severity: critical, high, medium or low.
- The score follows the anchors below. A reviewer may not give 8 or higher while an open critical or high finding exists in their lens.
- Owner-pending decisions recorded in `.local/autopilot.md` (for example multiple terminals for 025-AC-077) are not scored as defects; the reviewer lists them separately.

## Score anchors (all lenses)

| Score | Meaning |
|---|---|
| 10 | Exemplary. No finding above low. Would be used as the reference for this lens in other projects. |
| 9 | Excellent. No finding above low; at most a few low findings. |
| 8 | Ready to ship. No critical or high finding; medium findings are few, local and have a clear fix. |
| 7 | Nearly ready. No critical; at most one high, or several medium findings that touch more than one area. |
| 5–6 | Works, but needs a planned rework in this lens before release. |
| 3–4 | Serious problems: several high findings or a design flaw in this lens. |
| 1–2 | Not acceptable: a critical finding, or the lens's basic duty is not met. |

## Lenses and what each one checks

| Lens | Agent | Checks (at minimum) |
|---|---|---|
| Code | `erfana:code-reviewer` | Correctness and edge cases in `src/main/services/browser/**`, `src/main/ipc/browserTab/**`, `src/preload/browser*`, `src/shared/ipc/browser-tab-*`, `src/renderer/src/components/Panels/BrowserPanel/**`; TypeScript safety; error handling; React hooks and state; dead code; consistency with project conventions (`CLAUDE.md`). |
| Security | `erfana:security-auditor` | Electron hardening (session, `webPreferences`, fuses, CSP), the IPC identity gate and channel allow-list, CDP allow-list, the local-file loopback server (token, Host check, confinement), signed profile files, credential and certificate stores, hostile-page isolation (025-AC-046), logging of private data (025-FR-042, 025-AC-080), the Electronegativity record (`docs/technical-debt.md` entry 67). |
| Architecture | `erfana:architecture-reviewer` | Module boundaries between main, preload, shared and renderer; ADRs 0007–0012 followed; cohesion and coupling of the browser services; file size and the max-lines baseline; testability and seams. |
| UX | `erfana:ux-reviewer` | Flows against the spec use cases (UC-001 to UC-006); keyboard routing (F6 cycle, shortcuts), focus, screen-reader names and announcements, error and empty states, wording; screenshots under `test-results/browser-tab-ui/`. |
| UI | `erfana:ui-reviewer` | Design-system compliance (tokens only, `border-radius: 0`, `erf-` namespace, decided cards), visual fidelity to `docs/designs/browser/` with its "Differences in the build" table, contrast, states, `npm run lint:css` and `npm run design -- --check`. |
| Performance | `erfana:performance-reviewer` | Hot paths (bounds, key routing, pick hit test, capture), memory growth (log buffers, still images, listeners), IPC volume, start-up cost; bench results under `docs/performance/` where present (025-AC-049, 050, 082). |
| Test | `erfana:test-reviewer` | Unit and e2e test quality: assertions that would catch a real bug, mocking depth, flakiness (condition-based waits only), AC traceability (`node scripts/check-spec025-trace.mjs`), coverage floors (`vitest.*.config.ts`), `test.fail()` markers only for recorded owner-pending gaps. |

## Scores

Scores are added after this rubric is committed, one row per lens, with a link to the reviewer's full report.

| Lens | Score | Critical | High | Medium | Low | Report |
|---|---|---|---|---|---|---|

### Round 1 – 2026-11-04, against `873a9e4a`

| Lens | Score | Critical | High | Medium | Low | Report |
|---|---|---|---|---|---|---|
| Code | 8 | 0 | 0 | 1 | 7 | [reviews/code.md](reviews/code.md) |
| Security | 8 | 0 | 0 | 1 | 5 | [reviews/security.md](reviews/security.md) |
| Architecture | 7 | 0 | 0 | 5 | 3 | [reviews/architecture.md](reviews/architecture.md) |
| UX | 7 | 0 | 0 | 4 | 6 | [reviews/ux.md](reviews/ux.md) |
| UI | 6 | 0 | 2 | 6 | 5 | [reviews/ui.md](reviews/ui.md) |
| Performance | 7 | 0 | 1 | 3 | 4 | [reviews/performance.md](reviews/performance.md) |
| Test | 8 | 0 | 0 | 2 | 3 | [reviews/test.md](reviews/test.md) |

Four lenses are under 8. Every finding goes to a fix round; each lens is then reviewed again by a fresh agent of the same type, against the new HEAD.

### Round 2 – 2026-11-04, against `8fd4ed87` (fresh agents of the same types)

| Lens | Score | Critical | High | Medium | Low | Report |
|---|---|---|---|---|---|---|
| Code | 8 | 0 | 0 | 1 | 5 | [reviews/code-r2.md](reviews/code-r2.md) |
| Security | 9 | 0 | 0 | 0 | 2 | [reviews/security-r2.md](reviews/security-r2.md) |
| Architecture | 8 | 0 | 0 | 0 | 6 | [reviews/architecture-r2.md](reviews/architecture-r2.md) |
| UX | 8 | 0 | 0 | 2 | 5 | [reviews/ux-r2.md](reviews/ux-r2.md) |
| UI | 8 | 0 | 0 | 3 | 3 | [reviews/ui-r2.md](reviews/ui-r2.md) |
| Performance | 8 | 0 | 0 | 1 | 5 | [reviews/performance-r2.md](reviews/performance-r2.md) |
| Test | 8 | 0 | 0 | 1 | 3 | [reviews/test-r2.md](reviews/test-r2.md) |

Every lens scores 8 or higher, with no critical or high finding. The remaining medium findings are fixed after this round or recorded as technical debt; the fix record follows.

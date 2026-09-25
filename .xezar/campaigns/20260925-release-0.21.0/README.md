# Campaign release-0.21.0

Updated: 2026-09-25 11:06 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: ON since 2026-09-25T09:10:38Z (restarts 0 of 3). Parked calls go to parked.md.
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #146 ready, head 1f4f5c33 – #145 fix. Required checks green. Advisory Windows checks red: scripts/stop-orphan-mcp.test.mjs fails to load (SyntaxError at 10:1). Review 63ac9ab2 running (full-cold-review, claude/sonnet, gmail).
- #141 ready, head 749110db (develop merged in) – #138 spec. Re-check 9f406ac3 APPROVE at 0c6ad3a0, 0 findings. Labels design-approved + merge-queue; #138 labelled design-approved. Next: squash-merge when required checks are green at 749110db.
- #140 ready, head c442a15b – #139 spec. Re-check 12b29be1 APPROVE at c442a15b, all 11 findings fixed, no new defects. Labels design-approved + merge-queue; #139 labelled design-approved. Next in the merge line after #141: bring up to date, wait for green, squash-merge.
Six Dependabot PRs, not yet in scope: #63, #64, #65, #66, #67, #68.

## Serial merge line
1. #141 (checks running at 749110db)
2. #140 (update after #141 merges)

## Running tasks per lane
| Run | Issue | Workflow | Lane | Login |
|---|---|---|---|---|
| 63ac9ab2 | #146 | code-review (full-cold-review) | claude/sonnet | gmail |

Counts at dispatch (11:17): tasks 3/10 (xezar runs 2 at once, 1 queued), gate runs 0/2, metered 0/4, load 5.3/18.

## File-ownership table
- Reviews write no files. 63ac9ab2, 9f406ac3, 12b29be1 own nothing.

## Accounts (from `read_quota` at 2026-09-25T07:13:22Z)
| Runner | Login | State | Resets (UTC) |
|---|---|---|---|
| claude | default | reserved leader login, runs no tasks | – |
| claude | qodeca | ok (weekly 46%) | 2026-09-28 16:59 |
| claude | gmail | ok (weekly 34%) | 2026-09-25 19:00 |
| claude | eqamana | out | 2026-09-26 16:00 |
| claude | westagilelabs | ok (weekly 0%) | 2026-10-02 07:00 |
| codex | default | ok (weekly 0%) | 2026-10-02 00:13 |
| codex | qodeca-2 | ok (weekly 24%) | 2026-09-29 12:45 |
| pi | – | no logins | – |

## Held or queued work
- #142, #143, #144 – filed from the #141 inventory; ready, not yet triaged into order.
- #138 build – design approved 11:22; starts after #141 merges.
- #139 build – design approved 11:29; waits for #138's fixture and capture script.

## Owner items
- Label issues with `release-0.21.0` to put them in scope.
- Stop orphaned circuit-electron servers by hand until #146 merges (see timeline for PIDs).
- After #145 merges: leader adds the allow rule for `node scripts/stop-orphan-mcp.mjs` (approved).
- PR #140 open decisions, needed before #139 is built, not before its review: (1) go to apply repo description, topics, social preview; (2) extend TRADEMARKS.md to the new banner, wordmark, social image; (3) CI link check as a follow-up issue; (4) light-theme banner vs dark-only rule – owner only if the reviewer disagrees; (5) demo format WebP (after a spike) vs MP4.

## Rules that bit
- Load over 18 for more than one tick: check `pgrep -fl circuit-electron` for launchers with parent PID 1 before anything else. They ignore SIGTERM. Tell the owner at once; after #145 merges use `node scripts/stop-orphan-mcp.mjs`.
- xezar ack can fail with "no longer owns the project" while status says owner (seen 00:45-00:47, load over 130). Reads still work; retry ack later, never re-dispatch on it.
- A step agent must not end its turn while its own background work runs (XEZ:MONITORING fails the step). Say "finish in the foreground" in every brief.

## Restart and re-attach
Start with `./scripts/xezar-leader.sh`, then follow the session-start list in `.xezar/docs/leader-guide.md`.

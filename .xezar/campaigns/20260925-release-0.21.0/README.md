# Campaign release-0.21.0

Updated: 2026-09-25 11:06 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: ON since 2026-09-25T09:10:38Z (restarts 0 of 3). Parked calls go to parked.md.
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #150 ready, head 4e1e992c – #138 part A (a410722c). Windows checks red: shebang in scripts/check-links.mjs (same as #146). Review eb3b8cf0 running (full-cold-review, claude/sonnet, westagilelabs).
- #149 draft, head e57b8db6 – #138 spike note (320bec53). Login part stopped (needs a browser sign-in); owner makes the token. Q8: terminal text below the 7 px bar at 800 px; leader decision: capture-only zoom (#139 option).
- #148 ready, head 02d9c56c – #142 fix, round-1 fixes pushed, all checks green. Re-check 77285cdf running (scoped-recheck, claude/sonnet, gmail).
- #140 ready, head c442a15b – #139 spec. Re-check 12b29be1 APPROVE at c442a15b, all 11 findings fixed, no new defects. Labels design-approved + merge-queue; #139 labelled design-approved. Next in the merge line after #141: bring up to date, wait for green, squash-merge.
Six Dependabot PRs, not yet in scope: #63, #64, #65, #66, #67, #68.

## Serial merge line
Empty.

## Running tasks per lane
| Run | Issue | Workflow | Lane | Login |
|---|---|---|---|---|
| 77285cdf | #148 | code-review (scoped-recheck) | claude/sonnet | gmail |
| eb3b8cf0 | #150 | code-review (full-cold-review) | claude/sonnet | westagilelabs |

Counts at dispatch (14:36): tasks 2/10, gate runs 0/2, metered 0/4, load 3.6/18.

## File-ownership table
- Reviews write no files. 77285cdf and eb3b8cf0 own nothing.

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
- #143 – ready; held so it does not collide with #142 on tooltip code.
- #144 – ready; held behind the #138 build: both edit docs/features/README.md, docs/keyboard-shortcuts.md, docs/settings.md.
- #138 build – split: part A (plan steps 2-4) running as a410722c; step 1 spike running as 320bec53 (owner chose a subscription login, westagilelabs tried first); steps 5-8 follow.
- #139 build – design merged; waits for #138's capture script (part B).

## Owner items
- Label issues with `release-0.21.0` to put them in scope.
- Leader runs `node scripts/stop-orphan-mcp.mjs` at each L1 tick (worked at 12:39). Allow-rule PR for it still to do (owner-approved).
- Make the Claude Code token for the #138 capture (steps given 13:10).
- Decide whether to hide or delete the reviewer's junk test comments on PR #146.
- After #145 merges: leader adds the allow rule for `node scripts/stop-orphan-mcp.mjs` (approved).
- PR #140 open decisions, needed before #139 is built, not before its review: (1) go to apply repo description, topics, social preview; (2) extend TRADEMARKS.md to the new banner, wordmark, social image; (3) CI link check as a follow-up issue; (4) light-theme banner vs dark-only rule – owner only if the reviewer disagrees; (5) demo format WebP (after a spike) vs MP4.

## Rules that bit
- Never dispatch while the checkout holds unpushed campaign commits: the task's worktree is cut from the local develop and carries them into its PR (#148).
- Load over 18 for more than one tick: check `pgrep -fl circuit-electron` for launchers with parent PID 1 before anything else. They ignore SIGTERM. Tell the owner at once; after #145 merges use `node scripts/stop-orphan-mcp.mjs`.
- xezar ack can fail with "no longer owns the project" while status says owner (seen 00:45-00:47, load over 130). Reads still work; retry ack later, never re-dispatch on it.
- A step agent must not end its turn while its own background work runs (XEZ:MONITORING fails the step). Say "finish in the foreground" in every brief.

## Restart and re-attach
Start with `./scripts/xezar-leader.sh`, then follow the session-start list in `.xezar/docs/leader-guide.md`.

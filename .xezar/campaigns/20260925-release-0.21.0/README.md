# Campaign release-0.21.0

Updated: 2026-09-25 11:06 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: ON since 2026-09-25T09:10:38Z (restarts 0 of 3). Parked calls go to parked.md.
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #152 ready, head 51b6e052 – #151 shebang guard (455166db). All checks green. Review 06e118c8 running (claude/sonnet, westagilelabs).
- #153 ready, head 77b5c7e8 – #143 platform tooltip labels (322010ff). All checks green. Review 483d6b31 running (claude/sonnet, gmail).
- #149 ready, head dbbb88bb – #138 spike note, all 8 questions answered: login works with the token, 0 emails or identifiers on screen, Stop hook and acceptEdits work, Electron needs SHELL. Review 08eda96c running.
- #140 ready, head c442a15b – #139 spec. Re-check 12b29be1 APPROVE at c442a15b, all 11 findings fixed, no new defects. Labels design-approved + merge-queue; #139 labelled design-approved. Next in the merge line after #141: bring up to date, wait for green, squash-merge.
Six Dependabot PRs, not yet in scope: #63, #64, #65, #66, #67, #68.

## Serial merge line
Empty.

## Running tasks per lane
| Run | Issue | Workflow | Lane | Login |
|---|---|---|---|---|
| 4458b282 | allow rule | feature-implementation | claude/opus | gmail |
| 483d6b31 | #153 | code-review | claude/sonnet | gmail |
| 06e118c8 | #152 | code-review | claude/sonnet | westagilelabs |
| 08eda96c | #149 | code-review | claude/sonnet | gmail |
| 2a1e4316 | #138 part B | feature-implementation | claude/opus | qodeca |

Counts at dispatch (15:48): tasks 5/10 (xezar runs 2 at once), gate runs 1/2 (4458b282), metered 0/4, load 3.4/18.

## File-ownership table
- 4458b282 owns .claude/settings.json, scripts/stop-orphan-mcp.mjs (header comment)
- 2a1e4316 owns scripts/capture/** (except demo-project), package.json (capture entry), eslint.config.mjs (one block), docs/user-guide/**/images, docs/assets/readme/
- Reviews own nothing.

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
- #151 – running as 455166db.
- #144 – ready; held behind the #138 build: both edit docs/features/README.md, docs/keyboard-shortcuts.md, docs/settings.md.
- #138 build – split: part A (plan steps 2-4) merged (#150); step 1 spike done (#149); part B (steps 5, 5b, 6) running as 2a1e4316; steps 7-8 follow.
- #139 build – design merged; waits for #138's capture script (part B).

## Owner items
- Label issues with `release-0.21.0` to put them in scope.
- Leader runs `node scripts/stop-orphan-mcp.mjs` at each L1 tick (worked at 12:39). Allow-rule task 4458b282 stopped (XEZ:ASK: settings edit refused); owner added the two rules by hand (main checkout, uncommitted, and copied into the 4458b282 worktree); task continued 15:40 to commit and open the PR. At merge: drop the identical local change in the main checkout before pulling.
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

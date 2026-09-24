# Campaign release-0.21.0

Updated: 2026-09-25 00:35 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: ON since 2026-09-24T22:23:07Z (restarts 0 of 3). Parked calls go to parked.md.
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #140 draft, head 68d292ae – #139 design spec. Next: design review on a different model (queued on load ceiling).
Six Dependabot PRs, not yet in scope: #63, #64, #65, #66, #67, #68.

## Serial merge line
Empty.

## Running tasks per lane
| Run | Issue | Workflow | Lane | Login |
|---|---|---|---|---|
| 9f1fd373 | #138 | plan-and-spec (repair round 1) | claude/opus | qodeca |
| c83ebddf | #139 | research (2nd opinion, advisory) | pi/deepseek-flash | – |

Counts: gate runs 0/2, tasks 4/10 (only 2 run at once: machine-wide xezar maxParallel=2, so the two pi tasks are queued), metered 2/4 (pi, assumed metered), load 1.94/18.

## File-ownership table
- 9f1fd373 owns docs/features/*user-guide*, docs/designs/*user-guide*
- c83ebddf owns nothing in the repo (research, no PR)

## Accounts (from `read_quota` at 2026-09-24T22:02:49Z)
| Runner | Login | State | Resets (UTC) |
|---|---|---|---|
| claude | default | reserved leader login, runs no tasks | – |
| claude | qodeca | ok (weekly 45%) | 2026-09-28 16:59 |
| claude | gmail | ok (weekly 34%) | 2026-09-25 19:00 |
| claude | eqamana | out | 2026-09-26 15:59 |
| claude | westagilelabs | out | 2026-09-25 07:00 |
| codex | default | unknown (quota format changed in 0.156.1) | – |
| codex | qodeca-2 | ok (weekly 24%) | 2026-09-29 12:45 |
| pi | – | no logins | – |

## Held or queued work
- #138 build – waits for its design verdict.
- #139 build – waits for its design verdict and #138's fixture and capture script.

## Owner items
- Label issues with `release-0.21.0` to put them in scope.
- PR #140 open decisions, needed before #139 is built, not before its review: (1) go to apply repo description, topics, social preview; (2) extend TRADEMARKS.md to the new banner, wordmark, social image; (3) CI link check as a follow-up issue; (4) light-theme banner vs dark-only rule – owner only if the reviewer disagrees; (5) demo format WebP (after a spike) vs MP4.

## Rules that bit
- A step agent must not end its turn while its own background work runs (XEZ:MONITORING fails the step). Say "finish in the foreground" in every brief.

## Restart and re-attach
Start with `./scripts/xezar-leader.sh`, then follow the session-start list in `.xezar/docs/leader-guide.md`.

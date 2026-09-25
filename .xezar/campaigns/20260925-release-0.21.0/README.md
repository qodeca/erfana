# Campaign release-0.21.0

Updated: 2026-09-25 10:18 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: off (was on 2026-09-24T22:23:07Z to 2026-09-25T08:09:46Z, restarts 0, nothing parked).
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #141 draft, head b7864e20 – #138 design spec. Verdict REQUEST CHANGES (1 Major: demo format vs #140; 1 Minor). Fix queued on load ceiling.
- #140 draft, head 68d292ae – #139 design spec. Verdict REQUEST CHANGES (4 Major, 7 Minor/Nit). Fix queued on load ceiling; leader reconciliation is in the timeline at 01:43.
Six Dependabot PRs, not yet in scope: #63, #64, #65, #66, #67, #68.

## Serial merge line
Empty.

## Running tasks per lane
None.

## File-ownership table
None running.

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
- #145 MCP launcher leak – FIRST in the queue (owner). Touches scripts/run-mcp.js and .mcp.json only.
- #142, #143, #144 – filed from the #141 inventory; ready, not yet triaged into order.
- #138 build – waits for its design verdict.
- #139 build – waits for its design verdict and #138's fixture and capture script.

## Owner items
- Label issues with `release-0.21.0` to put them in scope.
- Load: 17 orphaned circuit-electron servers block all dispatch. Owner said stop them; the leader's kill was refused by the auto-mode permission check. Owner runs it.
- PR #140 open decisions, needed before #139 is built, not before its review: (1) go to apply repo description, topics, social preview; (2) extend TRADEMARKS.md to the new banner, wordmark, social image; (3) CI link check as a follow-up issue; (4) light-theme banner vs dark-only rule – owner only if the reviewer disagrees; (5) demo format WebP (after a spike) vs MP4.

## Rules that bit
- xezar ack can fail with "no longer owns the project" while status says owner (seen 00:45-00:47, load over 130). Reads still work; retry ack later, never re-dispatch on it.
- A step agent must not end its turn while its own background work runs (XEZ:MONITORING fails the step). Say "finish in the foreground" in every brief.

## Restart and re-attach
Start with `./scripts/xezar-leader.sh`, then follow the session-start list in `.xezar/docs/leader-guide.md`.

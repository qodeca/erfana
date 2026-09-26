# Campaign release-0.21.0

Updated: 2026-09-25 11:06 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: ON since 2026-09-26T06:49:11Z (restarts 0 of 3). Parked calls go to parked.md.
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #168 (#163 lift @electron/rebuild override + electron-builder 26.16.1), draft, head d4043abc, labels dependencies + do-not-merge. Gate passed; npm audit 16 -> 7; node-pty rebuilt (@electron/rebuild 4.2.0); `electron-builder --dir` green; packed app opened a working terminal. Security review 35479ba2 (opus): APPROVE-level + nit S-1; leader posted it (comment 5847266523). Code review 84cbb123 (sonnet, gmail, posted itself): REQUEST CHANGES – Windows checks job never runs @electron/rebuild, so no Windows evidence for the changed path (leader's brief wrongly named it). Round 1 relayed to 43131e43: fix PR body, list Windows-proof options, BLOCKED for owner; S-1 after #162 lands.
- #167 (#164 liteparse 2.14.7), draft, head 41d87f42, do-not-merge. Review 76be37d0 (claude/opus, westagilelabs) REQUEST CHANGES: 2 major (OCR failure now fatal in 2.x; OCR language data maybe only 15 languages), 4 minor (no real-engine tests; stale ImageMagick gate; Linux binaries shipped; THIRD-PARTY-LICENSES stale), 2 nits. Post refused (opus). Relayed to author 347fc1ce, round 1; finding 2 may need an owner decision (BLOCKED if languages drop).
- #155 ready, head d4fb29e7 – allow rule in scripts/xezar-leader-settings.json (4458b282): exactly 2 exact-match rules + one autoMode reason; all checks green. Next: security-review (widens tool access).
- #154 ready, head 5fce83d5 – #138 part B (2a1e4316): test fixed, workflow gates sealed, CI all green incl. Windows. Next: full-cold-review + design-review of the 52 images and demo (privacy).
- #140 ready, head c442a15b – #139 spec. Re-check 12b29be1 APPROVE at c442a15b, all 11 findings fixed, no new defects. Labels design-approved + merge-queue; #139 labelled design-approved. Next in the merge line after #141: bring up to date, wait for green, squash-merge.
Six Dependabot PRs, not yet in scope: #63, #64, #65, #66, #67, #68.

## Serial merge line
- #162 merged 2026-09-26 as c0cbc66f.

## Running tasks per lane
| Run | Issue | Workflow | Lane | Login |
|---|---|---|---|---|
| 347fc1ce | #167 review round 1 (#164) | dependency-maintenance (continued) | pi/deepseek-api/deepseek-flash | – |
| 43131e43 | #168 review round 1 (#163) | dependency-maintenance (continued) | pi/deepseek-api/deepseek-flash | – |

Counts at dispatch (16:05): tasks 3/10, gate runs 0/2, metered 3/4 (all pi), load 2.8/18. xezar workspace maxParallel 5 (owner, 16:07).

## File-ownership table
- Overlap accepted: 347fc1ce and 43131e43 share package.json/package-lock.json; both merge after v0.21.0, one at a time, the second rebased. Neither edits docs/security.md (#162 owns it).
- Reviews own nothing.

## Accounts (from `read_quota` at 2026-09-26T13:52:35Z)
| Runner | Login | State | Resets (UTC) |
|---|---|---|---|
| claude | default | reserved leader login, runs no tasks; ok (weekly 7%; now reports plan max – was team at 99% until 06:13Z, so the login behind `default` changed) | 2026-10-02 06:59 |
| claude | qodeca | ok (weekly 52%) | 2026-09-28 16:59 |
| claude | gmail | ok (weekly 6%) | 2026-10-02 18:59 |
| claude | eqamana | out | 2026-09-26 16:00 |
| claude | westagilelabs | ok (weekly 7%) | 2026-10-02 06:59 |
| codex | default | ok (weekly 11%; flapped to unknown at 03:13Z and 05:13Z–06:13Z) | 2026-10-02 10:44 |
| codex | qodeca-2 | ok (weekly 27%) | 2026-09-29 12:45 |
| pi | – | no logins | – |

## Held or queued work
- #144 – merged 2026-09-26 as a61b7517 (PR #160).
- #138 build – split: part A (plan steps 2-4) merged (#150); step 1 spike done (#149); part B (steps 5, 5b, 6) is PR #154: code review REQUEST CHANGES (1 major, run.mjs readLogin can empty the privacy deny-list); design review FAIL (7 privacy/state blockers B-1..B-10, 5 non-blocking); round 2 done at 46600c39; code recheck APPROVE at b543da12 with 1 minor (Windows test, run.test.mjs:220 vs sandbox.mjs:46; advisory Windows checks red); image re-review PASS WITH FOLLOW-UPS (2 guide-copy notes for step 7); merged 2026-09-25 as c1b1ad21; steps 7-8 follow.
- #139 build – PR #159: code review APPROVE, design review FAIL (B-1 account name in QA screenshots); round 1 done at 1f924f73 (B-1 masked, NB-1 stated as a limit, NB-2 documented deviation); design recheck PASS at 9203f493; QA FAIL only because 3 checks could not run (chrome-devtools emulate + evaluate_script denied in the QA session): dark mode, theme switch, reduced motion unverified live. Waiting for the owner.

## Owner items
- **#159: owner checks by hand (answered 2026-09-26 08:40)** – dark theme, banner theme switch, reduced-motion still on github.com, branch feature/139-readme-redesign. Leader merges on the owner's word with green checks. Earlier note: (dark theme, banner theme switch, reduced-motion still). Both QA and design sessions were denied the chrome-devtools emulate/evaluate_script tools. Options: (a) owner checks them by hand on github.com in ~2 minutes (branch feature/139-readme-redesign: switch OS dark mode, turn on Reduce motion), or (b) allow those two tools for review sessions and re-run QA. Leader recommends (a).
- `npm audit` on develop's lockfile (run by the #159 author, 2026-09-25 23:51): 16 advisories – 1 critical, 12 high, 3 moderate – none added by #159. Owner chose triage in 0.21.0: issue #161, task d71e7bf0.
- PR #159 QA screenshots at 56ba01bb showed the GitHub account name; being replaced, but the old files stay in the branch history (squash-merge keeps them out of develop). Decide if that history matters.
- Two Windows flakes seen on #158 (docs-only): useImageSource.test.ts 'keeps the last good image…' and check-shebangs.test.mjs 5000 ms timeout. Not in docs/windows/known-flakes.md yet; file or catalogue them?
- Review task a873f32c (claude/opus, gmail) was refused `jq … | bash .xezar/checks/gh-write.sh` 4 times (don't-ask mode), so it could not post its #158 verdict; earlier reviews on other logins posted. Look at why, or accept relaying.
- codex/default quota read flaps between ok and unknown ("Codex 0.156.1 changed its quota format"), while codex/qodeca-2 on the same version reads fine. Unknown is never out and never fine; qodeca-2 takes Codex work meanwhile. Look at the xezar quota reader for this login, or accept.
- Label issues with `release-0.21.0` to put them in scope.
- Leader runs `node scripts/stop-orphan-mcp.mjs` at each L1 tick (worked at 12:39). Allow-rule: repository-checks refuses permissions in .claude/settings.json (every read-only agent would get them). Owner chose the leader-only file scripts/xezar-leader-settings.json. Owner undid the edit in both places (17:55); 4458b282 continued to move the rules into the leader-only file (gate repair 2 of 2). Leader restart after merge.
- Decide whether to hide or delete the reviewer's junk test comments on PR #146.
- After #145 merges: leader adds the allow rule for `node scripts/stop-orphan-mcp.mjs` (approved).
- PR #140 open decisions, needed before #139 is built, not before its review: (1) go to apply repo description, topics, social preview; (2) extend TRADEMARKS.md to the new banner, wordmark, social image; (3) CI link check as a follow-up issue; (4) light-theme banner vs dark-only rule – owner only if the reviewer disagrees; (5) demo format WebP (after a spike) vs MP4.

## Rules that bit
- Review sessions get `gh-write.sh` / `verdict-write.sh` refused: claude/opus (a873f32c, ab0c9d7f, 612e0cf9, 35479ba2, 76be37d0) and, since 2026-09-26 16:55, claude/sonnet too (0d8a560d). Read the verdict from the task's final message; the leader posts an APPROVE verbatim on the PR, and relays a REQUEST CHANGES to the author. Read the verdict from the PR comment or the task history, close the session, relay.
- A review task can finish its review but be refused the GitHub post by its own permission check (a873f32c, 4 refusals). Do not work around it: relay the verdict to the author, who quotes it in the response comment, and say so.
- Never dispatch while the checkout holds unpushed campaign commits: the task's worktree is cut from the local develop and carries them into its PR (#148).
- Load over 18 for more than one tick: check `pgrep -fl circuit-electron` for launchers with parent PID 1 before anything else. They ignore SIGTERM. Tell the owner at once; after #145 merges use `node scripts/stop-orphan-mcp.mjs`.
- xezar ack can fail with "no longer owns the project" while status says owner (seen 00:45-00:47, load over 130). Reads still work; retry ack later, never re-dispatch on it.
- A step agent must not end its turn while its own background work runs (XEZ:MONITORING fails the step). Say "finish in the foreground" in every brief.

## Restart and re-attach
Start with `./scripts/xezar-leader.sh`, then follow the session-start list in `.xezar/docs/leader-guide.md`.

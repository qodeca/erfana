# Campaign release-0.21.0

Updated: 2026-09-25 11:06 CEST

## State
- Base: `develop` at `9fe8a3f0`. Merges so far: 0. Checkpoints met: none.
- Scope: open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader (the leader files it as an issue with that label). None labelled yet.
- Unattended mode: ON since 2026-09-26T06:49:11Z (restarts 0 of 3). Parked calls go to parked.md.
- The campaign name does not approve a release. The release go stays owner-only.

## Open pull requests
- #202 (#177 browser grant: emulate for QA/design review, unwired evaluate_script guard; safe app start split out – parked) merged 2026-09-26 as 0b95160e; #177 closed.
- #201 (#174 leader context: timeline bound, archiving dropped – parked) merged 2026-09-26 as d4fc1d61.
- #189 (load ceiling 40) merged 2026-09-26 as 25adc9a7.
- #188 (#171 vitest worker cap) merged 2026-09-26 as c27b399b (one CI unit-test crash before, rerun green).
- #187 (#176 Dependabot groups) merged 2026-09-26 as 80a8c032; #176 closed.
- #186 (#169 gate lanes, lint:check) merged 2026-09-26 as 7cfa65bc. S-5 nit → proposed follow-up issue (owner item).
- #185 (#179 spike) merged 2026-09-26 as 5f285011. Result: build the silence alert (+ line-86 doc fix); auto-continue deferred (parked).
- #184 (#172 spike) merged 2026-09-26 as 4d874fa7; #172 build held for owner.
- #183 (#133) merged 2026-09-26 as 6b763b38.
- #182 (#175) merged 2026-09-26 as 97d5c17c. #175 stays open for the remaining rows.
- #181 (#178) merged 2026-09-26 as a9792f3c.
- #180 (#173) merged 2026-09-26 as db105aab. Owner: enable Require merge queue on develop.
- #168 (#163 lift @electron/rebuild override + electron-builder 26.16.1), draft, head 164d93b9, do-not-merge until v0.21.0 ships. Security APPROVE (35479ba2); code review round 1 fixed – Windows Native Smoke run 36256339721 green on this branch (negative control failed as expected); recheck b5d01d5e APPROVE. Review-complete.
- #167 (#164 liteparse 2.14.7), draft, head 0fa58e18, do-not-merge until v0.21.0 ships. Round 1 fixed; recheck 0b92cbf1 (sonnet/gmail) APPROVE, posted itself.
Dependabot PRs, not in scope: #63-#68 (old config) and #192-#200 (new grouped config, opened 2026-09-26 ~20:10; #196 duplicates #167).

## Process speed-up plan v3 (owner-approved 2026-09-26)
Plan: /Users/marcinobel/.claude/plans/silly-swimming-turtle.md. Wave 1: #133, #173 merge queue, #178 Windows smoke, #175 brief templates. Wave 2 (after spikes): #169, #170, #172, #179. Wave 3: #174, #176, #177, #171 (only if ps shows vitest load). Dropped by owner: records branch, docs-only fast path. Interim rules in force: short plain-text verdicts in review briefs; batched record pushes.

## Serial merge line
- #162 merged 2026-09-26 as c0cbc66f.

## Running tasks per lane
| Run | Issue | Workflow | Lane | Login |
|---|---|---|---|---|
| 7371ef66 | #203 round 1 recheck | code-review | claude/sonnet | westagilelabs |

## File-ownership table
- 974c210b done (PR #188); vitest configs released.
- 7d5d7fc6 done (PR #189); .xezar/loops.json released.
- 392e7c9b done. Reviews own nothing.
- e1c555ca done (PR #202 round 4 at d5c8fbd2, cost about 125 USD); files released.
- 8dadb69a done (PR #201 merged as d4fc1d61); files released.
- 994fb3e5 done (PR #191 merged); gate files released. (9a85cf2c done; .github/dependabot.yml released, PR #187.) #170 (gate list) is unblocked: #186 merged.
- 253ba433 done (PR #203 round 1 at 5e4175b8); files released.
- Reviews own nothing.

## Accounts (from `read_quota` at 2026-09-26T21:13:04Z)
| Runner | Login | State | Resets (UTC) |
|---|---|---|---|
| claude | default | reserved leader login, runs no tasks; ok (weekly 13%, plan max; same numbers as westagilelabs – owner item) | 2026-10-02 06:59 |
| claude | qodeca | ok (weekly 56%) | 2026-09-28 16:59 |
| claude | gmail | ok (weekly 13%) | 2026-10-02 18:59 |
| claude | eqamana | ok (weekly 2%) | 2026-10-03 16:00 |
| claude | westagilelabs | ok (weekly 13%) | 2026-10-02 07:00 |
| codex | default | ok (weekly 16%) | 2026-10-03 17:10 |
| codex | qodeca-2 | ok (weekly 2%) | 2026-10-03 16:58 |
| pi | – | no logins | – |

## Held or queued work
- #144 – merged 2026-09-26 as a61b7517 (PR #160).
- #138 build – split: part A (plan steps 2-4) merged (#150); step 1 spike done (#149); part B (steps 5, 5b, 6) is PR #154: code review REQUEST CHANGES (1 major, run.mjs readLogin can empty the privacy deny-list); design review FAIL (7 privacy/state blockers B-1..B-10, 5 non-blocking); round 2 done at 46600c39; code recheck APPROVE at b543da12 with 1 minor (Windows test, run.test.mjs:220 vs sandbox.mjs:46; advisory Windows checks red); image re-review PASS WITH FOLLOW-UPS (2 guide-copy notes for step 7); merged 2026-09-25 as c1b1ad21; steps 7-8 follow.
- #139 build – PR #159: code review APPROVE, design review FAIL (B-1 account name in QA screenshots); round 1 done at 1f924f73 (B-1 masked, NB-1 stated as a limit, NB-2 documented deviation); design recheck PASS at 9203f493; QA FAIL only because 3 checks could not run (chrome-devtools emulate + evaluate_script denied in the QA session): dark mode, theme switch, reduced motion unverified live. Waiting for the owner.

## Owner items
- **#202 follow-up (not filed):** safe app start for QA/design review (round 3 design at eec611b1 plus open S-3 detached descendants and S-4 PID reuse). File an issue if wanted – issue creation needs your word.
- **#201 follow-up S-9 (minor, not filed):** the 64 KB timeline tail can cut one oversized timeline entry mid-way (timeline only; decisions.md stays whole). File an issue if wanted – issue creation needs your word.
- **#179 alert (merged #190 as ded31966):** install the launchd agent by hand, per the PR body.
- **#177 evaluate_script wiring (PR #202):** emulate is granted; evaluate_script stays denied because the guard hook cannot be registered per workflow. Options in the PR body: user-scope settings for the xezar profile, a filtering proxy in .mcp.json, or leave denied. Leader recommends leave denied until a QA run proves it is needed.
- **#172 review posting (spike PR #184):** fix needs either (a) an upstream xezar engine change (pass --settings to reading steps, or a verdict-body field) – recommended, file upstream; or (b) a user-scope PreToolUse hook in ~/.claude/settings.json on this machine (tested: 12k-char verdict posts, 0 denials; but it runs for every Claude session and is outside repo review). Interim rule (short plain-text verdicts) works today. Build held until the owner picks.
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
- Load over 40 (owner raised from 18 on 2026-09-26) for more than one tick: check `pgrep -fl circuit-electron` for launchers with parent PID 1 before anything else. They ignore SIGTERM. Tell the owner at once; after #145 merges use `node scripts/stop-orphan-mcp.mjs`.
- xezar ack can fail with "no longer owns the project" while status says owner (seen 00:45-00:47, load over 130). Reads still work; retry ack later, never re-dispatch on it.
- A step agent must not end its turn while its own background work runs (XEZ:MONITORING fails the step). Say "finish in the foreground" in every brief.

## Restart and re-attach
Start with `./scripts/xezar-leader.sh`, then follow the session-start list in `.xezar/docs/leader-guide.md`.

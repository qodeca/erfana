# Parked

Calls the leader made alone while the owner was away.

## 2026-09-25 18:27 – third repair round on PR #155 (stop-orphan-mcp allow rule)
- Chose: continued the author 4458b282 to fix security findings S-1 and S-2 in the same PR.
- Why: both are verified defects in the script the new permission makes prompt-free; the fix is small and inside the same 3 files. The two earlier rounds were gate repairs (settings file refused, then moved), not review findings.
- Rejected: split the script fix into its own PR first, then re-review #155. Costs one more review cycle for the same files.
- Undo: stop 4458b282, close its new commits' effect by asking for a split PR for scripts/stop-orphan-mcp.mjs; #155 stays unmerged until then.

## 2026-09-25 18:56 – fourth repair round on PR #155
- Chose: continued the author 4458b282 once more for S-2 (same-second PID reuse), with a small fail-closed fix (skip processes younger than 2 s).
- Why: S-1 is fixed; S-2 is now one narrow, fixture-verified gap in the same 3 files. The fix is a few lines and tests.
- Rejected: merge #155 with S-2 open as an accepted risk (the owner has to accept a security finding, not the leader), or split the script fix into its own PR (one more review cycle, same files).
- Undo: stop 4458b282 and ask for the split; until #155 merges the leader keeps asking before running the cleanup script.

## 2026-09-25 19:56 – third repair round on PR #154
- Chose: continued the author 2a1e4316 for one small fix: the Windows test failure in scripts/capture (sandbox.mjs:46, run.test.mjs:220), no re-capture of any image.
- Why: code and image reviews both pass; only the advisory Windows checks job is red. Merging would turn develop's Windows checks red for every later PR.
- Rejected: merge now and file a follow-up issue for the Windows test (quicker, but leaves develop red on Windows).
- Undo: stop 2a1e4316, merge #154 at b543da12 as reviewed, and file the Windows test as an issue.

## 2026-09-25 20:47 – lane switch for #138 steps 7-8 (PR #157)
- Chose: give the guide pages to the route's next docs-writing lane, codex/gpt-6-sol, to finish on PR #157's branch, instead of a second repair round on codex/gpt-5.6-terra.
- Why: two passes on gpt-5.6-terra produced stub reference pages (5-9 lines each) and a fold-in that only adds a pointer line; the design asks for full reference content moved from the old docs.
- Rejected: a third pass on gpt-5.6-terra (same model, same result likely); claude/opus (third lane, more costly, and keeps a non-Anthropic author for a Claude reviewer).
- Undo: stop the gpt-6-sol task and continue 03de6de3 instead; PR #157 keeps both lanes' commits.

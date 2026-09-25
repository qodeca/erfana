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

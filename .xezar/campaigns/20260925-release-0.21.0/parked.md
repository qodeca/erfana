# Parked

Calls the leader made alone while the owner was away.

## 2026-09-26 18:44 – #179 scope: build the silence alert, defer engine auto-continue (scope trim)
- **Chose:** build only part 1 of #179 (30-minute leader-silence alert: repo ships the check script and a launchd plist; the owner installs it on the Mac). Defer part 2 (engine auto-continue at no-decision stops) to an upstream xezar request, not built now.
- **Why:** spike PR #185 measured the two days: no-decision stops cost 14 of 1,280 parked minutes (1%); the alert targets 812 minutes (63%) and, replayed on the record, fires on all 3 real outages. Auto-continue needs an engine change outside this repo.
- **Rejected:** building both now as the owner chose ("Alert + safe auto-continue") – about 1% gain for an engine change.
- **Undo:** file the engine request and add part 2 back to #179's scope; nothing is built that blocks it.

## 2026-09-26T20:36:57Z – #201 fifth repair round (third+ round, owner asleep)
- **Chose:** a fifth round on the archive feature, binding each archive record to exact byte offsets plus the hash of the whole decisions.md prefix up to the entry (no occurrence counting). Told the author this is the last round; if it cannot hold, stop.
- **Why:** the owner chose "fix" twice tonight (rounds 3 and 4). Code review approves; only S-8 remains, and a prefix-hash binding makes any edit/insert/reorder invalidate the record (fail open) instead of moving it onto an open entry.
- **Rejected:** dropping archiving and merging only the timeline bound (my earlier recommendation, turned down by the owner at round 4).
- **Undo:** tell the leader to drop archiving; round 6 removes decisions-archive.mjs and the loader filter and keeps the timeline bound.

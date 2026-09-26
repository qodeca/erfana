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

## 2026-09-26T20:45:30Z – #201 scope trim: drop decision archiving, keep the timeline bound (owner asleep)
- **Chose:** round 6 removes decisions-archive.mjs and the loader's archive filter; decisions.md is injected whole again (plus the new missing-file warning); the timeline bound (newest 40 entries + pointer) stays. Most of the size saving (88.7 KB -> about 53 KB) comes from the timeline bound.
- **Why:** after five rounds the security review still finds a way to hide an open decision (S-8: a committed record can predict a future entry). Nothing in the repo can prove a record was written after its entry existed. Round 5 was announced as the last try.
- **Rejected:** a sixth attempt at archiving (needs a trusted proof of archival, for example signed records or leader-only writes – a bigger design).
- **Undo:** reopen archiving as its own issue with a trusted-proof design; the removed code is in PR #201's history (heads 2a3e4be9, 42110df6).

## 2026-09-26T20:57:30Z – #202 scope trim: split the safe app start out of #202 (owner asleep)
- **Chose:** round 4 removes review-run-app.mjs and its run entry; #202 keeps emulate, the unwired evaluate_script guard, the read-only bash allowlists and strict preflight. The safe app start becomes follow-up work.
- **Why:** round 3 fixed the file-write hole (S-2), but the security review still finds process-containment gaps (S-3: a detached child can escape cleanup; S-4: remembered PIDs can be reused by an unrelated process, which cleanup then signals). Reliable containment on macOS without root is a larger design; #202 already costs about 74 USD. The guide's own option for a third+ round is "split the helper into its own PR".
- **Rejected:** a fourth repair round on the wrapper (identity-bound tracking, fail-closed discovery, detached-descendant containment), which the owner may still prefer.
- **Undo:** the wrapper is in PR #202's history (head eec611b1); open a follow-up issue/PR from it with S-3/S-4 as its acceptance, or tell the leader to restore it into #202.

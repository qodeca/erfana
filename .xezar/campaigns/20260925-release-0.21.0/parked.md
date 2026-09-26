# Parked

Calls the leader made alone while the owner was away.

## 2026-09-26 18:44 – #179 scope: build the silence alert, defer engine auto-continue (scope trim)
- **Chose:** build only part 1 of #179 (30-minute leader-silence alert: repo ships the check script and a launchd plist; the owner installs it on the Mac). Defer part 2 (engine auto-continue at no-decision stops) to an upstream xezar request, not built now.
- **Why:** spike PR #185 measured the two days: no-decision stops cost 14 of 1,280 parked minutes (1%); the alert targets 812 minutes (63%) and, replayed on the record, fires on all 3 real outages. Auto-continue needs an engine change outside this repo.
- **Rejected:** building both now as the owner chose ("Alert + safe auto-continue") – about 1% gain for an engine change.
- **Undo:** file the engine request and add part 2 back to #179's scope; nothing is built that blocks it.

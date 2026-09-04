# Windows verification report – v0.19.0 preview on Windows 11

> **Point-in-time document.** The reply to §8 of [2026-09-03-windows-release-verification.md](2026-09-03-windows-release-verification.md). Commit SHAs, counts and issue states were true on 2026-09-04 and go stale immediately.

**Date**: 2026-09-04
**From**: Windows session (Windows 11 Pro 10.0.26200, x64)
**Verified**: `develop @ ae2527d2` (base), fixes on `fix/windows-preview-blockers` @ `6dd32d08` (13 commits)

---

## 1. Summary

The preview did not pass on Windows as shipped on `develop @ ae2527d2`: two blockers (Allow → Confirm froze on "Saving…"; an evicted preview tab never woke), a linear OS-handle leak (~44 handles per preview open/close), seven smaller defects and one security-review finding. All are fixed on `fix/windows-preview-blockers` @ `6dd32d08`. On this host all nine §4 gates are green on the branch head, and the four manual re-runs of the failed checks (Allow flow, 5-tab wake, 249-char path, https/mailto link) pass. Four of the 34 manual checks stay untested (§7); nothing else is open for the release except the follow-up #120.

## 2. §4 automated checks

| # | Command | 2026-09-03 (`ae2527d2`) | 2026-09-04 (`6dd32d08`) | Key output line (2026-09-04) |
|---|---|---|---|---|
| 1 | `npm run lint` | pass | pass | green (output not captured) |
| 2 | `npm run lint:css` | pass | pass | green (output not captured) |
| 3 | `npm run design -- --check` | **fail** (#104, CRLF checkout) | pass | `design-sync: 9 generated files up to date` |
| 4 | `npm run typecheck` | pass | pass | green (output not captured) |
| 5 | `npm run test:ci` | pass – 461 files, 11575 passed, 108 skipped | pass | 464 files, 11645 passed, 108 skipped |
| 6 | `npm run test:main` | pass | pass | same counts as `test:ci`, as recorded in the log |
| 7 | `npx electron-vite build` | pass | pass | green (output not captured) |
| 8 | `npm run test:e2e` | pass – 118 passed | pass | 121 passed, 8.6 min (three new preview specs from `c4366066`) |
| 9 | `npx playwright test --project=visual` | **fail** – 6 (baseline size drift + one missing win32 baseline) | pass | 6 passed against the regenerated win32 baselines (`6dd32d08`) |

The #104 failure was deterministic, not a path bug: `core.autocrlf=true` checked out `design/claims.js` and `design/index.html` as CRLF while the check regenerates LF and byte-compares. Fixed in `0cc448cc` (`.gitattributes` pin plus a CRLF-tolerant compare).

## 3. §5 tick list

Legend: result on 2026-09-03 against `ae2527d2`; "re-run" is the 2026-09-04 check on `6dd32d08` where one was done. Four rows carry "untested"; they match `docs/windows/known-flakes.md` § "Untested on the 2026-09-03 Windows verification".

### §5.1 paths

| # | Check | 2026-09-03 | Changed since | Re-run 2026-09-04 |
|---|---|---|---|---|
| 1 | `C:\` project, relative `.css`, `.js`, image | pass – all three load | – | – |
| 2 | Second drive letter (`D:\`) | untested – no second drive on this host | – | – |
| 3 | Path with spaces | pass | – | – |
| 4 | Polish characters (`Ćwiczenia`) | pass – correct in title, tree, terminal, preview | – | – |
| 5 | Deeply nested path over 260 chars | **fail** – "The preview stopped running." at 320 chars; bracketed later to 248 opens / 249 fails, so the cause is the 256-char `PanelIdSchema`, not MAX_PATH (Node fs and the editor were fine at 320) | `51bcd787` (bounded panel ids); `bf782211` (terminal now says a cwd over 260 chars is the OS limit) | pass – 249-char fixture renders `LEN-249-OK`, no badge, no `too_big` line |
| 6 | UNC / network path | untested – no share available | – | – |
| 7 | Subresource one folder up (`../assets/x.css`) | pass for the inside-project half (`sub/page2.html` loads `../assets/style.css`); the outside-project refusal half was not captured in the findings log | – | – |

### §5.2 link navigation

| # | Check | 2026-09-03 | Changed since | Re-run 2026-09-04 |
|---|---|---|---|---|
| 1 | Link to another `.html` → new tab, running | pass | – | – |
| 2 | Same link again → reuses the tab | pass | – | – |
| 3 | Link to `.md` → Markdown panel | pass | – | – |
| 4 | Link to an image → image viewer | pass | – | – |
| 5 | `#anchor` → scrolls, no new tab | pass | – | – |
| 6 | Link outside the project → refused, badged | pass on the refusal; the badge read "Missing local file" although the file exists (cosmetic, differs from the macOS description) | `25a9b361` – refused links are labelled by what happened | – |
| 7 | Link into `node_modules\` or `dist\` → opens as source | pass – both | – | – |
| 8 | `https://` link → asks, then hands to the default browser | **fail** – one guarded click on a fresh app: no dialog, no browser, no badge, no log line (a `javascript:` link on the same fixture was badged, so the click reached main) | `1fddf3e8` (dialog owned by the app window, every outcome logged, click race settled); `812aad59` (per-window gate) | pass – owned `#32770` dialog "Open this link outside Erfana?", log `asking` then `cancelled`; `mailto:` the same |
| 9 | `javascript:` link → nothing happens | pass – "Blocked link (1) / javascript:", page intact | – | – |

### §5.3 permission band and allowlist

| # | Check | 2026-09-03 | Changed since | Re-run 2026-09-04 |
|---|---|---|---|---|
| 1 | Remote CDN blocked, band lists the origin | pass | – | – |
| 2 | Allow → page reloads and the resource loads (#111) | **fail live** – Confirm stuck on "Saving…" >10 s, Cancel inert, chip not updated, no reload; the origin was written correctly and loaded after reopening the project, which is the end-to-end proof #111 asked for | `2aaf706a` (every await bounded, terminal state guaranteed); `41dfee95` (purge settles); `c4366066` (e2e proof) | pass – settled in 126 ms, chip "1 blocked · 1 allowed", live region "…is now allowed…reloading", no timed-out line |
| 3 | Close and reopen the project → approval still there | pass (confirmed three times) | – | – |
| 4 | `.erfana\settings.json` valid JSON, origin form, no corruption | pass – `https://cdn.jsdelivr.net`, no temp leftovers | – | – |
| 5 | `http://` → allowable, confirm warns not encrypted | pass – Allow button present, warning text shown | – | – |
| 6 | IPv6 literal → no Allow button, says why | pass – zero buttons, plain-language reason | – | – |
| 7 | Two hosts → own rows, approving one keeps the other | pass | – | – |

### §5.4 preview lifecycle and windows

| # | Check | 2026-09-03 | Changed since | Re-run 2026-09-04 |
|---|---|---|---|---|
| 1 | 4+ previews → only 3 live; click the frozen tab → wakes | cap works (live tabs kept ticking); **fail** on wake – page1 stayed blank after 11 s, no `suspended` ever reached the renderer | `6d74c3ec` (bounded teardown, own capture ledger); `41dfee95` | pass – 5 open, click page1 → live, "PAGE 1 … tick 66" |
| 2 | Still picture shows the page's own colours, not black | pass on "not black"; but only a flat background colour, no page content (no still frame was ever captured) | `6d74c3ec` | pass – the four parked tabs show real still frames |
| 3 | Display scaling 125% and 150% | untested – only this host's 200% was run (pass: sized correctly, no black band, no offset) | – | – |
| 4 | Close the window → no orphaned process | pass – 26 electron processes before, 0 after | – | – |
| 5 | External edit → refresh within ~1 s | pass – CSS-only save swaps in place and keeps scroll; HTML save does a full reload (two paths, both verified) | – | – |
| 6 | Delete the file while previewing | pass – banner + Reload, badge "Missing local file", recovers after restore | – | – |

### §5.5 toolbar

| # | Check | 2026-09-03 | Changed since | Re-run 2026-09-04 |
|---|---|---|---|---|
| 1 | Find (`Ctrl+F`) | pass – 1 of 7, next/previous, Escape clears, works with focus inside the page | – | – |
| 2 | Export to PDF | pass – native dialog owned by the app, 32,775-byte `%PDF-` file | `1fddf3e8` (save dialog now parented) | – |
| 3 | Zoom via View menu | Zoom Out and Actual Size pass (page shrinks, chrome unchanged); Zoom In untested – the harness could not press `CommandOrControl+Plus` | – | – |

### §5.6 file watching

| # | Check | 2026-09-03 | Changed since | Re-run 2026-09-04 |
|---|---|---|---|---|
| 1 | Open/close previews 10+ times, memory stays bounded (#112) | **fail** – +1051 then +1050 OS handles over two identical batches of 24 previews (~44 per open/close, linear); private memory 163.5 → 235.1 MB over 48 previews | `6d74c3ec`, `4ec75b37`, `41dfee95` | pass – 3430 → 3403 → 3348 handles over two batches of 12, zero growth, zero warn/error lines |
| 2 | Close a preview while the file is locked elsewhere | pass – exclusive lock held, no EBUSY/EPERM, no leftovers | – | – |

## 4. Host

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200 (build 26200.9168) |
| Node | v24.14.1 |
| Python | 3.14.3 (the handoff asked for 3.12; the node-pty rebuild itself was not exercised on this host) |
| Display | 3456×2168 physical at 200% scaling (1728×1084 logical); one monitor |
| Electron | 39 |
| Git | `core.autocrlf=true`, `LongPathsEnabled` (HKLM) = 0 |

## 5. What was surprising (not an open issue on 2026-09-03)

| Finding | Fixed in |
|---|---|
| **#117** – Allow → Confirm sticks on "Saving…": the approval awaited `session.clearStorageData()`, which never settles on this host, and nothing on the path was time-boxed | `2aaf706a`, `41dfee95` |
| **#118** – an evicted tab never wakes and parks as a flat colour block: teardown hung on the same purge so `suspended` was never emitted, and no still frame was ever captured | `6d74c3ec`, `41dfee95` |
| **#119** – an `https://` link does nothing: the consent dialog had no owner window, no logging, and lost a race between `will-navigate` and the preload's click report | `1fddf3e8`, `812aad59` |
| Handle leak (#112 was filed as "not user-visible"): ~+44 handles per open/close, linear; after `6d74c3ec` ~+11; after `41dfee95` zero over two batches of 12 | `6d74c3ec`, `41dfee95` |
| Leak root cause 1 – a fresh session partition per preview open (~16 handles each, never destroyable); fixed by recycling partition names | `41dfee95` |
| Leak root cause 2 – `clearStorageData()` never settles inside the full app on Windows because of the `shadercache` storage type alone (the other seven settle in 0–5 ms; a minimal app does not reproduce it); the purge now names the seven data-bearing storages | `41dfee95` |
| The 260-char preview failure is not MAX_PATH but the 256-char `PanelIdSchema` cap on a panel id that was the file path one-for-one (248 opens, 249 fails; bites macOS one char later) | `51bcd787` |
| `wc.isBeingCaptured()` reads true on a fresh preview here, so the still-frame cache skipped every capture; the first capture at `ready` also came back empty three times (a 250 ms retry fixes it) | `6d74c3ec` |
| Security review of the fixes: teardown detached the network filter, protocol handler and permission denials before destroying the page, leaving a hostile page up to ~3 s with no egress gate | `812aad59` |
| A terminal at a cwd over 260 chars failed with a bare "Failed to create terminal" (the OS limit, `CreateProcess`, regardless of `LongPathsEnabled`) | `bf782211` |

## 6. Issues

| Issue | State on 2026-09-04 | Action on merge |
|---|---|---|
| #83 | fixed – `4ec75b37` (`Closes #83`) | closes by keyword |
| #104 | fixed – `0cc448cc` (`Closes #104`) | closes by keyword |
| #111 | proven by hand (§5.3 row 2) and by e2e – `c4366066` (`Closes #111`) | closes by keyword |
| #115 | fixed – `475e0667` (`Closes #115`) | closes by keyword |
| #116 | fixed – `9b11af0a` (`Closes #116`) | closes by keyword |
| #112 | items 1–3 fixed in `4ec75b37`; item 4 split out into #120 | comment with the split, then close |
| #117 | new, fixed on the branch (`2aaf706a`, `41dfee95`) | close |
| #118 | new, fixed on the branch (`6d74c3ec`, `41dfee95`) | close |
| #119 | new, fixed on the branch (`1fddf3e8`, `812aad59`) | close |
| #120 | open follow-up – six small preview-lifecycle defects, none user-visible | stays open |

## 7. Left for a later release

| Item | Why |
|---|---|
| §5.1 second drive letter | No `D:` on this host |
| §5.1 UNC / network path | No share available |
| §5.4 display scaling at 125% / 150% | Only 200% tested; changing it is a system-wide setting on a one-monitor machine |
| §5.5 Zoom In through the View menu | Harness could not press the accelerator; Zoom Out and Actual Size pass |
| Visual baselines `settings-overlay` and `confirm-dialog` | Overlay elements that fill the window, so their win32 baselines still carry this host's 1384×861; a second Windows host may need a clipped page capture (known-flakes visual row) |
| #120 | Six small lifecycle defects split out of #112, not user-visible |

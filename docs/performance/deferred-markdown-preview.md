<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Deferred Markdown preview: remembered link checks (finding [31])

- **Finding:** [31] "Preview re-parses per keystroke with uncancelled exists IPC". The deferred, memoised render, the stable link key, the stale-result guard and the equal-map check landed in PR #290 ([2026-10-21 measurement](2026-10-21-deferred-preview.md)). This change adds the last part of the fix: `file.exists` answers are remembered, forgotten when the file structure changes or after 30 s, and re-checked at most a few times during a burst of changes – and not at all by hidden tabs.
- **Date:** 2026-10-22. **Host:** Apple M5 Max, macOS 26.6.2, Node 24, vitest + jsdom (development React build), 1-minute load average about 5.5. Three runs per version; every run gave identical counts, times varied by under 10 %.

## The answer

- **Editing a link in a large document no longer re-checks every link.** 20 keystrokes inside one link target cost **4** `file.exists` IPC calls, down from 2,004 on `develop` and 10,020 before PR #290.
- **Typing prose costs no link checks** (0 on `develop` too; 10,020 before PR #290).
- **Opening the document asks 301 times instead of 501:** a bare file name link (`notes.md`) asks about the current folder and the project root and then the target; when those are the same path, the cache answers the second and third.
- **A link to a file created after the preview opened stops showing as broken** – shortly after the change when this window hears about it (watcher event, catch-up refresh, or Erfana's own file operation), otherwise within about 30 s, when the "missing" answer expires. On `develop` it stayed broken until the set of links changed.
- **Agent-style churn stays cheap:** 50 file adds over 10 s with 5 previews open (2 visible) cost **3,010** `file.exists` calls while it lasts and 903 when the 3 hidden tabs are brought forward, against **75,250** without the debounce and the visibility gate.
- Render counts are unchanged from `develop`: 4 body renders per 20 keystrokes (40 before PR #290).

## Before and after

`src/renderer/src/components/Editor/MarkdownPreview.typing.measure.test.tsx`: a 2,000-line document (100 sections) with 300 internal links – 200 relative (`./docs/guide-N.md`, one check each) and 100 bare file names (`notes-N.md`, up to three checks) – rendered for `/proj/README.md`. 20 keystrokes, one every 80 ms (fake timers; `performance.now` stays real, so the preview's own live/debounced decision runs on real render cost), then 2 s to settle. "Commits" are React `<Profiler>` commits of the whole preview; "body renders" are commits of the expensive Markdown subtree.

| Measure (per 20 keystrokes) | Before PR #290 (`fcf8afa5^`) | `develop` (`13e80a23`) | This change |
|---|---|---|---|
| Prose: body renders | 40 | 4 | 4 |
| Prose: preview commits | 40 | 32 | 32 |
| Prose: `file.exists` calls | 10,020 | 0 | 0 |
| Prose: wall time (ms) | ~3,850 | ~325 | ~325 |
| Link target edited: body renders | 40 | 4 | 4 |
| Link target edited: preview commits | 40 | 36 | 36 |
| Link target edited: `file.exists` calls | 10,020 | **2,004** | **4** |
| Link target edited: wall time (ms) | ~3,760 | ~400 | ~380 |
| Opening the document: `file.exists` calls | 501 | 501 | **301** |

How to read it:

- **Commits stay above body renders** because the preview shell commits for each keystroke (it holds the latest content for export and the context menu); the memoised body skips those commits. They are cheap.
- **The 4 calls** are one per committed body render, each with a new link target. Before this change each of those renders re-checked all 301 targets (501 calls; 4 × 501 = 2,004).
- **jsdom, not Electron:** wall times are relative only. IPC is a mock that answers in a microtask, so the real cost of 2,004 round trips (each an `fs.access` in the main process) is larger than the jsdom wall time shows.

### Agent churn

Same document in 5 previews (5 panels, so 5 caches); 2 visible, 3 hidden. A structural `directory-watch:changed` broadcast (`{ add: 1 }`) every 200 ms for 10 s, 3 s to settle; then the hidden ones are shown. One run per version (counts are deterministic under fake timers).

| `file.exists` calls | `develop` (`13e80a23`) | Cache, no debounce (`e8283438`) | This change |
|---|---|---|---|
| Opening the 5 previews | 2,505 | 1,505 | 1,505 |
| During the 10 s of churn | 0 – links are never re-checked, so they go stale | **75,250** (50 events × 5 panels × 301) | **3,010** (2 visible panels × 5 re-checks × 301) |
| Showing the 3 hidden panels afterwards | 0 | 0 | 903 (one re-check each) |

The 5 re-checks per visible panel come from the 2 s maximum wait: a burst that never pauses for 400 ms still refreshes the links every 2 s. In the real app the main process also coalesces watcher events (`ThrottledWorker`, 75 ms collection window), so a burst usually reaches the renderer as fewer broadcasts than files written.

## What changed

| Layer | Before | After |
|---|---|---|
| `file.exists` per link check | Every target asked again whenever the set of links changed | Asked once; the answer is remembered per preview panel (`components/Editor/linkTargetCache.ts`). Same-path questions in flight share one answer; a failed check is not remembered; answers for links no longer in the document are dropped after each check |
| When remembered answers are forgotten | – | All at once on a structural `directory-watch:changed` event (an explicit `structural` flag when the payload has one, otherwise any type but `change`, or `catchUp`), or on any of this window's own create / delete / rename / move / copy calls through `fileGateway` (the watcher is paused for those, so they never arrive as events) – `services/fileStructureSignal.ts`. One by one after 30 s |
| After the file structure changes | Links kept their old state until the set of links changed | The preview re-checks all its links, 400 ms after the last change of a burst and at most 2 s after its first |
| A "missing" answer | Kept until the set of links changed | Expires after 30 s and the panel re-checks, so a change no event reported still shows up |
| Hidden tabs | – | Do not re-check; when shown, re-check once if anything changed or expired meanwhile (dockview `onDidVisibilityChange`) |
| Closing the panel | – | The cache goes with its last listener: no watcher listener, timer or answer outlives the unmount |
| Stale answers | A check superseded by a newer one (links or file changed) was dropped | Also dropped: a check that saw the cache invalidated while it was in flight (generation counter) |
| Clicking a link | Fresh check | Unchanged: opening a file always asks the disk |

## Reproduce

```sh
npm ci
ERFANA_MEASURE=1 npx vitest run src/renderer/src/components/Editor/MarkdownPreview.typing.measure.test.tsx
```

Each scenario prints one `[measure] {...}` JSON line (`-t churn` runs only the churn scenario). For the baselines, check out `MarkdownPreview.tsx`, `utils/markdownLinkResolver.ts` and `services/fileGateway.ts` from `origin/develop` (or `MarkdownPreview.tsx` and `markdownLinkResolver.ts` from `fcf8afa5^`) and run the same command; restore with `git checkout HEAD -- <files>`.

## Remaining limit

- **Changes no event reports reach the preview only through the 30 s age limit:** a folder the watcher skips (hidden, excluded or ignored paths), or another Erfana window's file operation inside its own watcher pause (#210). A link shown as missing is re-checked when its answer expires; a link shown as found is re-checked on the first re-check after its answer expired (a link edit, a structural event, showing the tab), so a deleted target can stay styled as found until then. Clicking a link always checks the disk, so a stale "found" never opens a missing file.

## Not covered
- Windows, and the Electron typing benchmark (`e2e/preview-typing.bench.ts`): its document links to only a handful of targets, so it would not show this change.

<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Deferred Markdown preview: remembered link checks (finding [31])

- **Finding:** [31] "Preview re-parses per keystroke with uncancelled exists IPC". The deferred, memoised render, the stable link key, the stale-result guard and the equal-map check landed in PR #290 ([2026-10-21 measurement](2026-10-21-deferred-preview.md)). This change adds the last part of the fix: `file.exists` answers are remembered and forgotten when the file structure changes.
- **Date:** 2026-10-22. **Host:** Apple M5 Max, macOS 26.6.2, Node 24, vitest + jsdom (development React build), 1-minute load average about 5.5. Three runs per version; every run gave identical counts, times varied by under 10 %.

## The answer

- **Editing a link in a large document no longer re-checks every link.** 20 keystrokes inside one link target cost **4** `file.exists` IPC calls, down from 2,004 on `develop` and 10,020 before PR #290.
- **Typing prose costs no link checks** (0 on `develop` too; 10,020 before PR #290).
- **Opening the document asks 301 times instead of 501:** a bare file name link (`notes.md`) asks about the current folder and the project root and then the target; when those are the same path, the cache answers the second and third.
- **A link to a file created after the preview opened stops showing as broken.** On `develop` the link stayed broken until the set of links changed; now any added, removed or moved file or folder (watcher event, catch-up refresh, or Erfana's own file operation) makes the preview re-check.
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

## What changed

| Layer | Before | After |
|---|---|---|
| `file.exists` per link check | Every target asked again whenever the set of links changed | Asked once; the answer is remembered per preview panel (`components/Editor/linkTargetCache.ts`). Same-path questions in flight share one answer; a failed check is not remembered; answers for links no longer in the document are dropped after each check |
| When remembered answers are forgotten | – | A `directory-watch:changed` event with any type but `change`, or `catchUp`; or any of this window's own create / delete / rename / move / copy calls through `fileGateway` (the watcher is paused for those, so they never arrive as events) – `services/fileStructureSignal.ts` |
| After the file structure changes | Links kept their old state until the set of links changed | The preview re-checks all its links |
| Stale answers | A check superseded by a newer one (links or file changed) was dropped | Also dropped: a check that saw the cache invalidated while it was in flight (generation counter) |
| Clicking a link | Fresh check | Unchanged: opening a file always asks the disk |

## Reproduce

```sh
npm ci
ERFANA_MEASURE=1 npx vitest run src/renderer/src/components/Editor/MarkdownPreview.typing.measure.test.tsx
```

Each scenario prints one `[measure] {...}` JSON line. For the baselines, check out `MarkdownPreview.tsx`, `utils/markdownLinkResolver.ts` and `services/fileGateway.ts` from `origin/develop` (or `MarkdownPreview.tsx` and `markdownLinkResolver.ts` from `fcf8afa5^`) and run the same command; restore with `git checkout HEAD -- <files>`.

## Not covered

- A link into a folder the watcher skips (hidden, excluded or git-ignored paths): an external change there sends no event, so its answer is kept until another structural change or until the panel is reopened. Erfana's own operations there still invalidate.
- Windows, and the Electron typing benchmark (`e2e/preview-typing.bench.ts`): its document links to only a handful of targets, so it would not show this change.

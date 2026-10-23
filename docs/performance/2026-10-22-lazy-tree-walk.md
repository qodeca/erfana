<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Opening a large project: the lazy tree walk (finding [32])

- **Finding:** [32] "Serial tree walk including ignored folders" (lens review of v0.21.0, Wave 4 of v0.22.0). Branch `perf/lazy-tree-walk`.
- **Date:** 2026-10-22. **Host:** Apple M5 Max, 128 GB, macOS 26.6.2, APFS on the internal SSD, Node 24.20.0 under vitest (the main-process walk only, no Electron window). 1-minute load average 4.7–5.1 during the runs.
- **Data:** 3 interleaved rounds (before, after, before, after, before, after); each round is 6 walks of the project root, the first one discarded to warm the OS file cache. The table gives the median of the three rounds' medians per side, and in brackets the range over all 15 kept walks. Warm cache only – a cold cache needs `sudo purge` and was not measured.

## The answer

- **Typical project with a big ignored folder** (~25k files, 20k of them in `.venv`): the first tree is ready in **6 ms instead of 83 ms**, with **107 instead of 1,312 folder reads**, and the tree sent to the window shrinks from 6.2 MB to 0.9 MB.
- **Huge project with nothing ignored** (~120k files): the walk stops reading new folders at 50,000 rows and leaves the rest as lazy rows, so the first tree is ready in **70 ms instead of 237 ms**, with 1,348 instead of 3,152 folder reads and 11 MB instead of 27 MB sent to the window.
- **Parallel reads alone** (same huge project, cap lifted for the measurement): 237 → 152 ms. With the cap and parallel reads lifted (one read at a time, as before) the new code takes 188 ms – the shared collator and the restructured walk account for that part.
- The sort order is unchanged (folders first, then the old `localeCompare` order – pinned by a test).

## Before and after

| Measure | Before | After |
|---|---|---|
| mixed-25k: walk time (ms) | 83 (66–97) | **6** (5–7) |
| mixed-25k: `readdir` calls | 1,312 | **107** |
| mixed-25k: rows in the first tree | 26,112 | 4,109 (`.venv` and `dist` are lazy rows) |
| mixed-25k: tree payload (JSON) | 6.19 MB | 0.89 MB |
| plain-120k: walk time (ms) | 237 (218–277) | **70** (60–80) |
| plain-120k: `readdir` calls | 3,152 | 1,348 |
| plain-120k: rows in the first tree | 123,152 | 50,992 (the rest behind lazy rows) |
| plain-120k: tree payload (JSON) | 27.09 MB | 11.24 MB |
| plain-120k, cap lifted: walk time (ms) | 237 | 152 (150–177), 1 run of 5 walks |
| plain-120k, cap lifted, 1 read in flight: walk time (ms) | 237 | 188 (183–241), 1 run of 5 walks |

How to read it:

- **The walk time is the main-process part only.** The window still has to receive and render the tree; the payload column is the size of what crosses IPC, which is what the renderer pays for. Both shrink with the walk.
- **On this SSD with a warm cache a folder read costs roughly 50–70 µs** (walk time over read count, inferred), so the gains here are mostly fewer reads and less to build. On a slow disk, a network drive or Windows (where each read is far dearer, see [#211](./211-large-project-windows-run.md)) the saving per avoided read is larger, and parallel reads overlap the wait. **Not measured on Windows** – see the PR's Windows test list.
- **node_modules is not in the numbers:** it is tree-hidden by default, so neither walk ever read it. The lazy rule applies to folders on `watcher.ignoreList` that the tree shows (`dist`, `build`, `.venv`, `.next`, `coverage`, ...), and to `node_modules` only when a project's `tree.hiddenPatterns` no longer hides it.

## What changed

| Part | Before | After |
|---|---|---|
| Ignored folders | Listed in full, every level | A folder matching `watcher.ignoreList` **on whole segments** is a row with `lazy: 'ignored'` and no children; expanding it reads one level (its own sub-folders stay lazy). `outline` is not lazy for `out` – the watcher keeps its substring rule |
| Reads | One `readdir` at a time, depth first | Sub-folders in parallel, at most `WALK_READ_CONCURRENCY` (24) file-system calls in flight per walk – the `readdir`s and the `stat`/`realpath` of folder links share the slots; a folder holds a slot only for its own read, and a folder past the cap is not queued at all. The limiter's queue takes a task in O(1) (with `Array.prototype.shift` a 65,000-deep queue took ~1.9 s to drain, 200,000 ~15 s). libuv's pool runs 4 at a time, so the rest queue there; 4, 8 and 24 are to be compared on Windows (PR list) before the value moves |
| Huge trees | Walked to the end | After `MAX_WALK_ENTRIES` (50,000) rows, a folder whose turn comes is left lazy (`lazy: 'capped'`); reads in flight still finish. The base folder is always read. Expanding a capped folder reads one level of it (`file:readDirectory` with `shallow: true`), its sub-folders capped in turn |
| Sort | `localeCompare` per comparison | One shared `Intl.Collator` – specified to give the same order |
| Links | Once per walk, checked before an `await` | Same rule; the check and the reservation now run with no `await` between them, so two links read in parallel cannot both enter one folder. The link that loses is a `linked` lazy row – its files show under the folder it leads to, so it does not make the tree incomplete – and one past `MAX_ENTERED_LINKS` is `capped`; both expand. A real loop stays an empty row |
| Renderer | Rendered `files` as sent | `useLazyFolderChildren` reads a lazy folder on expand and keeps the result in `useLazyFolderStore`; the tree and the terminal's file links both see the merged tree (`useMergedProjectFiles`). A folder that turns lazy keeps the children it showed until it is read again. After a new base tree only lazy folders in view are read again; the rest on their next expand. A failed read stores nothing and counts as unread |
| Terminal file links | Index of the whole tree | Index of the merged tree. While a `capped` folder is unread the tree is incomplete: a name is also searched for in main (`file:findByName`: the project root only, at most 20 results, 20,000 folders in a bounded list, 16 reads in flight, a hard 1.5 s deadline; at most 2 searches in the process, one per project + name, 8 waiting), every match from the tree and the search is offered once in the chooser, and the chooser says the list may be incomplete. The renderer shares one search per name in flight and caches answers per project session, never a failure |
| Watcher record (#316) | Seeded by root reads only | An expand read adds its folder's entries, so a rename-style save in an expanded capped folder stays a content change; a later root read keeps what is known below folders it leaves lazy again. The record is indexed by folder, so an expand read visits only its folder's entries, not the whole record (5,000 reads against a 90,000-entry record: ~3.6 s before, ~40 ms after) |
| Log | `readDirectory completed` | Adds `folderReadCount`, `lazyFolderCount`, `entryCapReached`, and `shallow: true` on an expand read |

Walk hints for the Windows watcher are unchanged: a lazy folder is still recorded as one, and nothing below a dropped folder ever was. A capped walk records only the hints it met.

## Method

- Generate the projects: `node docs/performance/2026-10-22-lazy-tree-walk.gen.mjs <scratch>` writes `mixed-25k` (24,801 files: 4,000 Markdown files in 100 folders, 20,400 in `.venv/lib/python3.12/site-packages/pkg*/{,sub,sub/deep}`, 400 in `dist`) and `plain-120k` (120,001 files in 3,000 folders).
- Harness: a throw-away vitest file in `src/main/services/` that builds a `FileService` with the default hidden and ignore lists (`DEFAULT_TREE_HIDDEN_PATTERNS`, `DEFAULT_WATCHER_IGNORE_PATTERNS`), wraps `fs/promises.readdir` in a pass-through spy, and times `readDirectory(root)` with `performance.now()`. Rows are counted over the returned tree; the payload is `JSON.stringify(tree).length`.
- Before is `src/main/services/FileService.ts` from `origin/develop` at 1320f2ad, swapped in for each "before" run; after is this branch.

## Reproduce

```sh
node docs/performance/2026-10-22-lazy-tree-walk.gen.mjs .local/bench
# put the harness described above at src/main/services/zzBenchLazyTree.test.ts, then:
BENCH_DIR=.local/bench npx vitest run --config vitest.main.ts src/main/services/zzBenchLazyTree.test.ts
```

## Not measured

- A cold file cache, and any spinning or network disk.
- Windows and Linux.
- The renderer side (IPC transfer, React render of the tree) – only the payload size is given.
- The time to expand a lazy folder – by construction one `readdir` of that folder plus one IPC round trip.

## Known limits

- **OneDrive "online-only" files (Windows) are not found by `file:findByName`.** libuv reports every reparse point as a link, and cloud placeholders are reparse points, so the search – which never follows a link – skips a file that is not downloaded, and anything in a folder that is not (inferred from libuv's directory listing; not tested on a OneDrive folder).
- A read that hangs (a stale network mount) no longer holds up a name search past its 1.5 s deadline, but it still holds one of libuv's 4 pool threads until the system call returns, as a hanging read in the tree walk does.

<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Manual Windows run: the 222k-entry project on the native watcher (#211, W17)

- **Issue:** [#211](https://github.com/qodeca/erfana/issues/211). **Design:** [W17 and AC8](../designs/211-large-project-windows-watcher.md#9-acceptance-criteria-traceability); spike: [W0](../spikes/211-windows-fs-watch.md).
- **Date:** 2026-09-29, times local. **Host:** Windows 11 Pro 10.0.26200, NTFS – the W0 host. **Build:** dev build of `fix/211-large-project-windows-stall`.
- **Project:** `<project>`, the Xezar repository – the ~222k-entry project from the issue. Its test suite kept creating and deleting folders under `.local/test-tmp` for most of the run; that is the churn measured below.
- **Data:** the main-process log (`<home>/.erfana/logs/main.log`, plus `main.1.log` for the part before it rotated at 21:05), this dev instance's lines only, and the tester's run notes where marked. Two older Erfana builds were running on other projects (about 34k chokidar handles between them); their lines were ignored, but they shared the disk.
- **Scope:** **no exclude list** – `excludePatternCount: 0` on every read. This run measures the root-cause fixes alone (the native watcher, and the watcher starting after the first read). The run with `.local/test-tmp` excluded is still to do – see "With the exclusion – pending".

## The answer

- **First tree in 8.1 s** (was 148 s), with git status answering in 0.2–0.6 s meanwhile (was 2.2–26 s). The watcher started 0.4 s after the first read and was ready 8.7 s after open (was 141 s).
- **32–40 Windows handles and 154–393 MB rss** for the whole run (was ~162k handles, ~1.9 GB).
- **Churn in a visible folder still re-reads the whole tree** – expected without the exclusion: 264 tree reads in 76 minutes, mostly 7–14 s each, longest found 43 s (was 846 s). 1,137 buffer overflows became 342 resyncs; `errorCounts` stayed empty.

## Before and after

| Measure | Before (issue #211) | This run, no exclusion |
|---|---|---|
| First tree | 148 s | 8.1 s – 40,649 files and 43,866 folders |
| Git status | 2.2–26 s | 0.2–0.6 s during the first read; max 3.2 s under churn (tester's tally) |
| Watcher ready after open | 141 s | 8.7 s |
| Watch handles (`resourceCount`) | ~162k | 32–40 |
| Main-process rss | ~1.9 GB | 154–393 MB (peak working set 426 MB) |
| Longest tree read under churn | 846 s | 43 s (longest found); mostly 7–14 s |

## First read (AC1, AC2, AC5)

| After open | Event |
|---|---|
| 0.04 s | Project switch done (36 ms); root tree read 1 starts |
| 0.44 s, 0.67 s, 5.52 s | Git status answers: 383, 613 and 203 ms end to end |
| 8.19 s | Read 1 completes: 8,143 ms, `excludedEntryCount: 0`, `walkHintCount: 64` |
| 8.61 s | Directory watch starts – backend `native-recursive` |
| 8.66 s | `Native directory watcher ready` – plan built in 45 ms |

- File open during the first read was **not exercised** – the first file was opened 3.8 s after it. Record it in the pending run.
- Quiet re-reads before the churn took 5.9–7.3 s (reads 2, 6, 7 and 8).

## The watcher plan: `planCapped: true`, `walkHints: 64`

| Field | Value | Meaning |
|---|---|---|
| `recursiveWatches` | 11 | one recursive handle per planned child folder |
| `splitFolders` | 2 | the root and one folder below it, each watched non-recursively |
| `walkHints` | 64 | dropped (hidden or ignored) nested folders taken from the first read – exactly the cap |
| `planCapped` | `true` | at least one plan cap was hit |

`walkHintCount` was 64 on every read of the run, so the walk met more dropped nested folders than it may record. The log does not name the cap that tripped; with no exclude entries and 13 planned handles against a 512 cap, it is almost certainly the 64-hint cap (inferred). The cost: dropped folders past the cap stay inside a recursive watch. Their changes are still dropped one by one and never reach the tree, but a heavy burst inside one can overflow that watch's buffer and force a full re-read – [design deviation 1](../designs/211-large-project-windows-watcher.md#9-acceptance-criteria-traceability). It did not show here, because the churn was in a visible folder anyway.

## Under churn

Health lines, every 2 minutes (logged at `warn` once `nativeResyncs > 0`):

| Time | Events received | `nativeOverflows` | `nativeResyncs` | Handles | rss (MB) |
|---|---|---|---|---|---|
| 20:32 | 143 | 0 | 0 | 32 | 154 |
| 21:30 | 47,304 | 374 | 177 | 35 | 393 |
| 21:32 | 54,316 | 497 | 208 | 32 | 164 |
| 21:34 | 59,049 | 537 | 227 | 35 | 361 |
| 21:36 | 66,297 | 610 | 264 | 40 | 359 |
| 21:38 | 70,261 | 659 | 282 | 33 | 340 |
| 21:40 | 77,868 | 748 | 321 | 34 | 359 |
| 21:42 | 82,708 | 1,132 | 339 | 36 | 163 |
| 21:44 | 83,132 | 1,137 | 342 | 33 | 301 |
| 21:46 | 83,164 | 1,137 | 342 | 32 | 162 |

- `eventsFiltered` and `matcherBudgetExceeded` stayed 0: without an exclude list the churn folder is visible, so every batch reaches the tree. AC4 is not tested by this run.
- The 1 s / 5 s resync debounce held: 21:40–21:42 brought 384 overflows but only 18 resyncs. The `Directory watcher resync` line is rate-limited (`suppressedCount`), so count resyncs from the health counters, not from those lines.
- Reads never overlapped in the lines examined (#208 single-flight); during churn the next read often started within 0.6 s of the previous one.

Tester's tally per 2-minute window (git status max in the 21:35 window: 2.9 s):

| Window | Tree reads | Change batches | Git status max |
|---|---|---|---|
| 21:37 | 6.9–12.8 s | 495 | 3.2 s |
| 21:39 | 9.4–14.4 s | 609 | 1.9 s |
| 21:41 | 8.5–23.2 s | 577 | 1.7 s |
| 21:43 | 8.3–11.1 s | 188 | – |
| 21:45 | 8.0–8.8 s | 5 | – |

### The 43-second read

| Read 201 | |
|---|---|
| Duration | 42,989 ms, 21:29:51.8 → 21:30:34.8 |
| Size | 41,592 files, 44,446 folders – the same as read 200 before it (41,584 / 44,441, 11.5 s) |
| Overlap | none – read 200 ended 0.55 s before, read 202 started 0.53 s after |
| Where the time went | about 37 s inside `.local/test-tmp`: its first and last `ENOENT` (a folder deleted mid-walk, recovered) came 2.6 s and 40.0 s into the read |
| Main thread | change batches and git answers kept being logged throughout (longest gap about 2 s) – no stall |
| Git status meanwhile | 0.2–1.9 s end to end |

Cause, inferred: disk and antivirus contention from the test suite creating and deleting folders under `.local/test-tmp` while the walk was inside it. The walk is sequential, as it was before this branch (assumed, not re-checked), so this is not a regression. Excluding `.local/test-tmp` should remove it; the pending run checks that.

## Acceptance criteria in this run

| AC | Target | This run | Status |
|---|---|---|---|
| AC1 | first tree ≤ ~30 s with the exclusion, faster without | 8.1 s without | met for this arm |
| AC2 | file open ≤ ~2 s, git status ≤ ~3 s during the first read | git 0.2–0.6 s; file open not tried | git met, file open pending |
| AC3 | visible new file ≤ ~5 s under excluded churn | needs the exclusion | pending |
| AC4 | excluded churn starts no re-read | needs the exclusion | pending |
| AC5 | reads and git status do not wait for the watcher | watcher started after read 1; git answered during it | met |
| AC8 | documented manual run | this page | partial |

**Is `.local/` gitignored in Xezar?** Yes – `<project>/.gitignore` has `/.local/`, so the D10 assumption behind AC2 holds for this exclusion. Git status listed 97–114 files throughout the run.

## With the exclusion – pending

Add the entry to `<project>/.erfana/settings.json` (or the global `<home>/.erfana/settings.json`), reopen the project – the list applies at the next open – and confirm `excludePatternCount: 1` on `readDirectory completed`:

```json
{ "files": { "exclude": [".local/test-tmp"] } }
```

| Record | Target | Result |
|---|---|---|
| First tree | ≤ ~30 s (AC1) | – |
| File open and git status during the first read | ≤ ~2 s and ≤ ~3 s (AC2) | – |
| New visible file while the test suite runs | in the tree ≤ ~5 s (AC3) | – |
| `readDirectory started` / `Directory changed` during test-suite-only churn | none (AC4) | – |
| `eventsFiltered`, `nativeOverflows`, `nativeResyncs` | overflows far below 1,137 | – |
| `nativeOverflows` during `git checkout` and a build | recorded | – |
| CPU after deleting a watched top-level folder | back to idle within seconds | – |
| The 43 s outlier | gone | – |

## Log excerpts

Scrubbed: paths as `<project>`; instance tags, pids, digests and per-process memory removed; health lines trimmed to the fields shown.

```text
20:29:51.733 Project switch: starting {"oldPath":null,"newPath":"<project>"}
20:29:51.774 FileService: readDirectory started {"readId":1,"followUp":false,"callers":1}
20:29:52.173 git:getStatus IPC completed {"durationMs":383,"fileCount":97,"truncated":false}
20:29:52.407 git:getStatus IPC completed {"durationMs":613,"fileCount":97,"truncated":false}
20:29:59.921 FileService: readDirectory completed {"durationMs":8143,"fileCount":40649,"dirCount":43866,"hiddenPatternCount":2,"maxDepth":10,"excludePatternCount":0,"excludedEntryCount":0,"walkHintCount":64,"matcherBudgetExceeded":0,"readId":1}
20:30:00.346 Directory watcher backend selected {"backend":"native-recursive"}
20:30:00.394 Native directory watcher ready {"recursiveWatches":11,"splitFolders":2,"walkHints":64,"planCapped":true,"elapsedMs":45}
20:32:00.351 [info] DirectoryWatcher health {"eventsReceived":143,"eventsFiltered":0,"nativeOverflows":0,"nativeResyncs":0,"errorCounts":{},"resourceCount":32,"rss":154}
21:29:54.456 [warn] FileService: readDirectory error recovered {"path":"<project>\\.local\\test-tmp\\<test folder>","error":"ENOENT: no such file or directory, scandir '…'"}
21:30:34.810 FileService: readDirectory completed {"durationMs":42989,"fileCount":41592,"dirCount":44446,"excludePatternCount":0,"walkHintCount":64,"readId":201}
21:41:40.158 Directory watcher resync {"reason":"overflow","paused":false,"suppressedCount":1}
21:46:00.539 [warn] DirectoryWatcher health {"eventsReceived":83164,"eventsFiltered":0,"nativeOverflows":1137,"nativeResyncs":342,"matcherBudgetExceeded":0,"errorCounts":{},"peakEventsPerSecond":231.8,"resourceCount":32,"rss":162}
```

Not in the main log: `Project switch: settings loaded` (not among this run's switch lines – the count comes from `readDirectory completed`), the renderer's `File tree loaded` / `File tree refreshed` (renderer log, not collected), and the absence of `Directory changed` / `readDirectory started` under excluded churn (needs the pending run).

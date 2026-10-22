<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Content-only saves no longer re-read the tree (finding [29])

- **Finding:** [29] "Content-only change triggers a full tree re-read and resend" (lens review of v0.21.0, v0.22.0). Branch `perf/watcher-structural-refresh`.
- **Date:** 2026-10-22. **Host:** Apple M5 Max, 128 GB, macOS 26.6.2, production build (`npx electron-vite build`). Other agents were working on the machine; 1-minute load average 4.3–7.3 across the runs.
- **Benchmark:** [`e2e/watcher-structural.bench.ts`](../../e2e/watcher-structural.bench.ts), 3 runs before and 3 after, each a fresh app launch. "Before" is the same branch with the six changed watcher sources checked out from `develop` (`13e80a23`).

## The answer

For 50 content-only saves on a 25,000-file project, the tree is re-read **50 → 0 times**, and the renderer receives **189 MB → 8.75 KB** over IPC. Git status refreshes as before (40–41 calls; its own 500 ms cooldown merges a few saves).

## Before and after

Identical in all three runs unless a range is given.

| Measure | Before | After |
|---|---|---|
| `file:readDirectory` calls | 50 | **0** |
| Main-process time in those calls, total | 1,650 ms (1,640–1,947) | **0** |
| Tree payload sent to the renderer, total (JSON) | 189.2 MB (3.78 MB per read) | **0** |
| `directory-watch:changed` broadcasts | 50 (7.8 KB) | 50 (8.75 KB – one `structural` field each) |
| `git:getStatus` calls | 40–41 | 40–41 |

How to read it:

- **The main-process time is the walk only** – about 33 ms per read on this fast machine. It does not include cloning 3.78 MB into the renderer, rebuilding the tree there and re-rendering it, which the benchmark does not time. The payload size is the honest proxy for that work; on a slower disk or a Windows project of 200k entries each read takes seconds (see #208).
- **The broadcasts stay**: git badges and anything else listening still hear about every save. Only the tree's re-read is skipped.

## Setup

- **Project:** 250 folders × 100 Markdown files plus a root `README.md` (25,001 files), generated once outside the repository – `~/.cache/erfana-bench/` on macOS, because Erfana refuses to open a project under `/private/var/folders`, where `os.tmpdir()` resolves.
- **Load:** after the first tree, 8 s for the watcher to start; then one line appended to `folder-NNN/note-000.md` in 50 different folders, from outside the app, 400 ms apart – past the main-process throttle and the 250 ms renderer debounce, so every save is its own broadcast (the worst case for "before"); then 3 s to settle.
- **Counting:** in the main process, by wrapping the `file:readDirectory` and `git:getStatus` handlers (through Electron's private `ipcMain._invokeHandlers` map – fine for a benchmark, never for a test) and the window's `webContents.send`. Payload size is `JSON.stringify` of the returned tree.

Re-run:

```sh
npx electron-vite build
ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=after ERFANA_BENCH_RUNS=3 \
  npx playwright test --project=bench watcher-structural --workers=1
```

## What changed

| Piece | Before | After |
|---|---|---|
| `directory-watch:changed` payload | No way to tell a content edit from a new or removed file | `structural: false` only for a batch of `change` events; `true` for any add, addDir, unlink or unlinkDir, for every catch-up, resync or compensating refresh, and for the first batch after a buffer overflow |
| `useDirectoryWatcher` | Re-read the whole tree for every broadcast | Skips a `structural: false` batch; a payload without the flag still counts as structural |
| Tree refresh debounce | 250 ms trailing, no limit – a steady stream of changes could hold it back indefinitely | 250 ms trailing, at most 1 s after the first event of a burst |
| `useGitStatus` | Refreshed for every broadcast | Unchanged |

Out of scope: incremental tree updates (only the changed branch) stay with #150.

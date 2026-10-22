<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Content-only saves no longer re-read the tree (finding [29])

- **Finding:** [29] "Content-only change triggers a full tree re-read and resend" (lens review of v0.21.0, v0.22.0). Branch `perf/watcher-structural-refresh`, PR #316.
- **Date:** 2026-10-22. **Host:** Apple M5 Max, 128 GB, macOS 26.6.2, production build (`npx electron-vite build`), the native recursive watcher (the macOS default). Other agents were working on the machine; 1-minute load average 2.6–7.3 across the runs.
- **Benchmark:** [`e2e/watcher-structural.bench.ts`](../../e2e/watcher-structural.bench.ts), 3 runs per row, each a fresh app launch. "Before" is the same branch with the changed watcher sources checked out from `develop` (`13e80a23`).

## The answer

On a 25,000-file project, 50 content-only saves re-read the whole tree **50 times before and 0 times after**, for both ways a save reaches the disk: written in place, and written to a temp file that is renamed over the target (Erfana's own `atomicWrite`). The renderer no longer receives the 189 MB of tree data those reads sent. Git status refreshes as before.

Only these two save patterns on this Mac were measured. Linux (chokidar) and Windows were not.

## Before and after

Identical in all three runs unless a range is given.

| Measure | In place, before | In place, after | Temp + rename, before | Temp + rename, after |
|---|---|---|---|---|
| `file:readDirectory` calls | 50 | **0** | 50 | **0** |
| Main-process time in those calls, total | 1,650 ms (1,640–1,947) | **0** | 1,501 ms (1,488–1,542) | **0** |
| Tree data sent to the renderer, total (JSON) | 189.2 MB (3.78 MB per read) | **0** | 189.2 MB | **0** |
| `directory-watch:changed` broadcasts | 50 (7.8 KB in all) | 50 (8.75 KB) | 50 (7.65 KB) | 50 (8.75 KB) |
| `git:getStatus` calls | 40–41 | 40–41 | 40–41 | 40 |

The first fix (the `structural` flag alone) took in-place saves to 0 reads but left temp + rename saves at **50 of 50**: the native watcher sees the rename as an `add`. The second fix (the record of entries the tree shows, below) brought those to 0 too.

How to read it:

- **The main-process time is the walk only** – about 30 ms per read on this fast machine. It does not include cloning 3.78 MB into the renderer, rebuilding the tree there and re-rendering it, which the benchmark does not time. The data size stands in for that work. On a slower disk, or on a Windows project of 200k entries, one read takes seconds (see #208); that was not measured here.
- **The broadcasts stay**: git badges and anything else listening still hear about every save, and each broadcast grows by one `structural` field. Only the tree's re-read is skipped.

## Setup

- **Project:** 250 folders × 100 Markdown files plus a root `README.md` (25,001 files), generated once outside the repository – `~/.cache/erfana-bench/` on macOS, because Erfana refuses to open a project under `/private/var/folders`, where `os.tmpdir()` resolves.
- **Load:** after the first tree, 8 s for the watcher to start; then one save to `folder-NNN/note-000.md` in 50 different folders, from outside the app, 400 ms apart – past the main-process throttle and the 250 ms renderer debounce, so every save is its own broadcast (the worst case for "before"); then 3 s to settle. `ERFANA_BENCH_SAVE_MODE=inplace` appends a line; `rename` writes `.erfana-tmp-…` beside the file and renames it over the target.
- **Counting:** in the main process, by wrapping the `file:readDirectory` and `git:getStatus` handlers (through Electron's private `ipcMain._invokeHandlers` map – fine for a benchmark, never for a test) and the window's `webContents.send`. Data size is `JSON.stringify` of the returned tree.

Re-run:

```sh
npx electron-vite build
ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=after ERFANA_BENCH_SAVE_MODE=rename ERFANA_BENCH_RUNS=3 \
  npx playwright test --project=bench watcher-structural --workers=1
```

## What changed

| Piece | Before | After |
|---|---|---|
| `directory-watch:changed` payload | No way to tell a content edit from a new or removed entry | `structural: false` only when every event, raw and coalesced, is a `change`; `true` for any add, addDir, unlink or unlinkDir, for every catch-up, resync or compensating refresh, and for the first batch after a buffer overflow. Shared type: `DirectoryChangedPayload` |
| Coalescing | `unlink`/`unlinkDir` + `add`/`addDir` on one path became `change` | Only a file-to-file `unlink` + `add` becomes `change`; a swap involving a folder stays a create |
| Rename-style saves | The native watcher's `add` for a file renamed over an existing one counted as new | The service keeps a record of the files and symlinks the last root tree read showed (`KnownEntries`, at most 100,000; above that, rename-style saves are structural again) and follows it with the watcher's events. An `add` of an entry already shown, of the same kind, is a content change; a file↔symlink swap is structural |
| `useDirectoryWatcher` | Re-read the whole tree for every broadcast | Skips a `structural: false` batch; a payload without the flag still counts as structural |
| Tree refresh debounce | 250 ms trailing, no limit – a steady stream of changes could hold it back indefinitely | 250 ms trailing, at most max(1 s, 2 × the last refresh) after the first event of a burst |
| `useGitStatus` | Refreshed for every broadcast | Unchanged |

Out of scope: incremental tree updates (only the changed branch) stay with #150.

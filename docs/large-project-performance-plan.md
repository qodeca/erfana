# Large-project performance – implementation plan

> Created: 2026-04-03
> Status: In progress (4 of 6 done)
> Scope: Issues #146, #147, #148, #149, #150, #151
> Related: #60 – renderer crash on very large projects, landed (section below); #208 – overlapping tree reads on a very large, constantly changing project, fixed (section below); #211 – large projects stalling on Windows, fixed on its branch, unreleased (section below)
> Provenance: the issue numbers #146–#151 and #136, and the commit SHAs quoted in this plan, are **pre-migration** – they belong to the private tracker and history that were rewritten at the 2026-06 repository migration, so they do not resolve in `qodeca/erfana` or in this repo's `git log`. They are kept as provenance, not as links. #60, #208 and #211 are current-repo issues.

## Context

Opening a 56K-file repository (escape-fitness, 11GB `.git` with Git LFS) exposed cascading failures across the git status → tree render pipeline: EMFILE infinite loops, silent watcher failures, main-thread blocking, full-tree re-renders, and no diagnostic visibility.

Six issues were filed. This document defines the implementation order based on dependency analysis.

## Implementation order

### 1. #151 – Diagnostic logging instrumentation (foundation) ✅

- **Type:** Enhancement | **Risk:** Low | **Effort:** Medium | **Status:** Done (91c3ae6, f327623)
- **Why first:** Touches 15 files across the entire pipeline. Every subsequent issue modifies files that #151 instruments. Doing this first provides measurable evidence for verifying all later fixes. Low risk – structured logs only, no behavior changes.
- **Key deliverables:** ~37 structured log entries, timing instrumentation (`performance.now()`), threshold warnings, rate-limited error-path logging, periodic health snapshots.

### 2. #146 – EMFILE cascade in DirectoryWatcherService (critical bug) ✅

- **Type:** Bug fix | **Risk:** Medium | **Effort:** Small | **Status:** Done (07a976b)
- **Why second:** The most actively destructive bug – 4,497 errors in 4 minutes, infinite restart loop. The fix is surgical: close watcher before scheduling restart, add cooldown. With #151's instrumentation already in place, the fix is immediately verifiable via logs.
- **Key deliverables:** Close existing watcher on EMFILE before restart, global EMFILE cooldown, burst cap on restart scheduling.

### 3. #148 – GitWatcherService silent start failure (bug) ✅

- **Type:** Bug fix | **Risk:** Low | **Effort:** Small | **Status:** Done (addressed by #136 diagnostic logging + lifecycle fixes)
- **Why third:** Small fix (defensive logging + timeout fallback verification), closely related to #146 (both involve watcher lifecycle). After #146 fixes the EMFILE cascade, the watcher might actually start successfully for large repos – or the logs will show exactly why it doesn't.
- **Key deliverables:** Defensive logging at `start()` call site, verify `WATCHER_READY_TIMEOUT_MS` fallback, surface start result in health summary.

### 4. #149 – React memoization for ProjectTree (renderer-only)

- **Type:** Performance | **Risk:** Low | **Effort:** Medium
- **Why here:** Pure renderer-side work (`React.memo`, `useCallback`, Zustand selectors). Zero overlap with main-process fixes above. Gives an immediate perceived performance win by stopping the re-render cascade on every git status update.
- **Key deliverables:** `React.memo()` on ProjectTreeNode and GitStatusBadge, `useCallback` for handlers, Zustand shallow equality for git Maps.

### 5. #147 – Git status worker thread offload (major architecture) ✅

- **Type:** Enhancement | **Risk:** High | **Effort:** Large | **Status:** Done (bee25a4, dd6dbb3, 1041497)
- **Why fifth:** Highest-impact single change (unblocks main thread), but biggest architectural shift – new worker thread, new IPC patterns. By this point, logging (#151), stable watchers (#146, #148), and optimized renderer (#149) are in place, isolating regressions to the worker change itself.
- **Related spec:** spec-t3-022-git-status-offload (archived)
- **Key deliverables:** Worker thread for `statusMatrix()`, repo size guard, `filepaths` filter option.

### 6. #150 – Lazy tree loading and virtualization (largest scope)

- **Type:** Performance | **Risk:** High | **Effort:** Large
- **Why last:** Deepest refactor – changes `readDirectory()` from eager to lazy, adds incremental IPC updates, introduces virtualization library. Touches both main and renderer. Benefits from all prior work being stable. Most likely to surface new edge cases that #151's logging will help diagnose.
- **Key deliverables:** Lazy subdirectory loading on expand, incremental FS event diffs, `react-window` or `@tanstack/react-virtual` for viewport-only rendering.

## Related: #60 – renderer crash on very large projects (landed)

Not one of the six issues above, but it landed in the same problem space and changes what "large project" means here: the failure mode is no longer a crash, it is slowness.

**What shipped.** Opening a 174k-node project threw `RangeError: Maximum call stack size exceeded` in `flattenTree` (`src/renderer/src/hooks/useDragDropTree.ts`) – `flattened.push(...flattenTree(child))` is `Function.prototype.apply`, whose argument count is bounded by the engine stack (~10^5 on V8), so the first directory with a large enough flattened subtree threw, React 18 unmounted the root, and the window went black. The flattener is now an explicit-stack loop pushing exactly one node per iteration, output-identical to the recursion (pre-order DFS, forward sibling order, `depth` per level, `index` reset per parent). The crash is gone at 174k nodes and pinned by a 200k-node fixture. Landing with it:

- a **single-pass memo** producing the flattened array *and* a `path → node` index in one traversal – deletes a second ~174k-object copy (`enhancedFlattenedItems`) and replaces six linear `.find` scans, one of which ran per drag-over event;
- **two-tier error containment** – `PanelErrorBoundary` around the project tree, `RootErrorBoundary` + a distinct `FallbackGuard` at the root, plus a global error trail for async/handler errors – so a renderer defect degrades to a recovery screen instead of a blank window;
- **main-process crash logging** – `render-process-gone`, `child-process-gone` and per-window `unresponsive` / `responsive`, log-only;
- **per-window entry-module capture** – renderer console errors (`error` level only) and preload errors, the only trace of a boot failure that leaves the window blank without killing the process. Every renderer-supplied string is length-bounded at 1 000 characters and the console trail is capped at 20 records per window per 10 s, followed by one summary line carrying the dropped count. Log-only, like the rest;
- **flatten instrumentation** – `[ProjectTree] flatten completed` with `{ nodeCount, durationMs }`, at `info` above a 50 ms threshold and `debug` below.

Design of record: [`docs/design/design-issue-60.md`](./design/design-issue-60.md).

**Follow-up trigger.** Two `[ProjectTree] flatten completed` log lines within 3 s of opening a project ⇒ **file the tree-rebuild dedup against #149/#150**. A double build at open is suspected but unconfirmed; the instrumentation above exists so the next report carries evidence instead of a hunch.

**Still owned by #149/#150** – explicitly out of scope for #60, which fixed the crash without making a 174k-node project fast:

| Deferred item | Owner |
|---|---|
| `React.memo` on `ProjectTreeNode` (verified absent) | #149 |
| List virtualization of the project tree | #150 |
| Lazy / on-demand directory loading | #150 |
| ≤2 s TTI budget (scan ~2.0 s + IPC clone ~1.2 s dominate) | #149/#150 |
| Cancelable project open | #150 |
| Tree-rebuild dedup, once the trigger above fires – the read side is addressed by #208 (section below); a second *build* at open is not | #149/#150 |

## Related: #208 – overlapping tree reads (fixed)

[#208](https://github.com/qodeca/erfana/issues/208): on Windows, a project of about 200k entries that kept changing made Erfana exit with nothing in the log. Every watcher-driven refresh (every 250 ms under churn) and every file operation started a new full-tree read, in the renderer and again in main, while earlier reads – 25 s to 13 min each on that project – were still running. Each built its own tree in main and cloned it to the renderer, and main most likely ran out of heap (inferred – the 4-hour soak on such a project has not been run yet).

**What shipped** (listed under Unreleased in the [changelog](./CHANGELOG.md#unreleased) until the next release):

- **Single-flight tree reads** – one read per project scope in `useProjectManagement.refreshFiles`, one walk per resolved path in `FileService.readDirectory`, both on the shared `src/shared/coalescingRunner.ts`. At most one read runs plus one queued follow-up per burst, never two at once. This addresses the **tree-refresh dedup**: overlapping reads of the same project can no longer stack, whatever triggers them. A generation + sequence ticket on every result drops stale trees, so the tree never goes back to an older state.
- **Memory diagnostics** – the 120 s `DirectoryWatcher health` line logs at `info` (was `debug`, so it never reached `main.log` at the default level) and carries main-process heap (`heapUsed` against `heapLimit`) and per-process working sets, so a heap-exhaustion exit leaves a trend behind.
- **Walk trace** – `FileService: readDirectory started` / `completed` / `failed` / `still running` / `joined follow-up read`, each with `pathDigest` and a `readId` (`behindReadId` on the joined line), so overlap can be checked from `main.log` in the field.

Details: [File watching § Tree refresh is single-flight](./file-watching/technical-details.md#tree-refresh-is-single-flight-208); log lines and the overlap check: [Logging § Tree reads and memory](./logging.md#tree-reads-and-memory-208).

**What stays open.** Overlapping reads can no longer stack; the memory effect is pending the soak test. A very large project that never stops changing still re-reads its whole tree back to back, keeping CPU and disk busy. Deliberately out of scope for #208:

| Open item | What it would fix |
|---|---|
| Entry cap on a tree read | One read of ~200k entries still builds and clones the full tree |
| Lazy / on-demand directory loading (overlaps #150) | Removes full-tree reads altogether |
| `.gitignore`-aware reading | Skips build output and caches that inflate the tree |
| Read cancellation (overlaps #150's cancelable project open) | After a switch, a walk of the old project keeps running until it ends; closing and reopening the same project waits for it; and a walk that never finishes (an unreachable network drive) blocks every later read of that folder until Erfana restarts |
| The `withWatcherPause` window | An external change made during the follow-up read an internal file operation is waiting on can be missed until the next change – one read long, as before #208; closing it needs own-versus-external attribution of watcher events |

The double tree *build* at open (the #60 follow-up trigger above) is a separate question: the project-open load and a refresh that starts after it are both newer than the tree on screen, so both are still applied.

## Related: #211 – large projects stalling on Windows

[#211](https://github.com/qodeca/erfana/issues/211): on a Windows project of about 222,000 entries the first tree took 148 s, and opening a file, git status and later refreshes stalled while it ran. Three causes: chokidar 3 on Windows opened one `fs.watch` handle per folder and scanned the whole project while the first tree read ran, both competing for libuv's four-thread pool; the watcher started at once instead of after the first read; and every watcher batch – including `.git/index.lock` churn and changes inside ignored folders – re-read the whole tree and refreshed git.

**Status:** implemented on `fix/211-large-project-windows-stall`, not yet released (listed under Unreleased in the [changelog](./CHANGELOG.md#unreleased)). The unit, real-file-system (Windows) and local e2e suites pass. **The manual measurement on the 222k-entry project (design W17: first-tree time with and without an exclusion, file open and git status during the first read) has not been recorded yet**, so no timing improvement is claimed here.

**What shipped:**

- **A `files.exclude` list** in `~/.erfana/settings.json` and a project's `.erfana/settings.json` (the project list adds to the global one). An excluded folder is not read by the tree walk, not shown, and not watched. This is the manual, opt-in answer to the #208 open item "`.gitignore`-aware reading" – it is not gitignore-aware, and git status still covers the whole repository.
- **A native recursive watcher on Windows** (macOS and Linux stay on chokidar 3.6.0): one watcher per project on Node's `fs.watch`, a bounded plan of at most 512 handles, and no handle at all for excluded, hidden or ignored folders it knows of – at the top level, along exclude paths, and wherever the last root tree walk met one. Lost events cost one debounced re-read per burst. `ERFANA_DIRECTORY_WATCHER=chokidar` forces the old backend for diagnosis.
- **Nothing competes with the first read:** the directory watcher starts only after the project's first tree read settles, and a watcher batch whose paths are all excluded, hidden or ignored never reaches the renderer, so it starts neither a tree re-read nor a git refresh.

Details: [File watching § Watch backends](./file-watching/README.md#watch-backends-211), [§ The Windows native watcher](./file-watching/technical-details.md#the-windows-native-watcher-211); log lines: [Logging § Large projects on Windows](./logging.md#large-projects-on-windows-211); limits: [Known issues § Excluded folders](./known-issues.md#excluded-folders-filesexclude-known-limits); design: [`docs/designs/211-large-project-windows-watcher.md`](./designs/211-large-project-windows-watcher.md); spike: [`docs/spikes/211-windows-fs-watch.md`](./spikes/211-windows-fs-watch.md).

**Left to #150 or to follow-ups** – deliberately out of scope for #211:

| Open item | Owner |
|---|---|
| Lazy or incremental tree loading, virtualization | #150 |
| Cancelable reads (also the #208 open item) | #150 |
| A parallel tree walk – only as the lever if the W17 measurement misses the first-tree target, weighed against file-open latency | #150 |
| Content-only watcher batches skipping the full tree re-read (a `structural` flag on `directory-watch:changed`) | follow-up issue |
| Re-planning the Windows watch when a dropped folder appears after the project opened | follow-up (known limit) |
| An `@parcel/watcher` backend – only if W17 shows overflow re-reads under ordinary work | follow-up, contingent |
| Git status honouring the exclude list | follow-up |

Every broadcast batch – structural or content-only – still re-reads the whole tree, as before; #211 only stops the batches that contain nothing visible.

## Dependency graph

(Issue numbers below are pre-migration provenance – see the note at the top.)

```
#151 Logging ──→ #146 EMFILE fix ──→ #148 GitWatcher fix
                                          │
#151 Logging ──→ #149 Memoization         │
                                          ▼
                                     #147 Worker thread ──→ #150 Lazy tree + virtualization
```

- #151 is a prerequisite for all others (provides verification evidence)
- #146 and #148 are sequential (same subsystem, #146 may resolve #148)
- #149 is independent of main-process work (can run in parallel with #146/#148)
- #147 should follow stable watchers (#146, #148)
- #150 depends on #147 (lazy tree benefits from non-blocking git status)

## Guiding principles

1. **Instrumentation before fixes** – measure first so every change has evidence of improvement or regression
2. **Bug fixes before optimizations** – pathological behavior (EMFILE loops, silent failures) would confuse benchmarking
3. **Renderer and main-process work can overlap** – #149 is independent and can be developed in parallel with #146/#148 if desired
4. **Worker thread before virtualization** – if `statusMatrix()` still blocks the main thread for 5–30s, lazy-loaded tree nodes will still freeze during git status refresh

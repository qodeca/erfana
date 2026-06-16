# Large-project performance – implementation plan

> Created: 2026-04-03
> Status: In progress (4 of 6 done)
> Scope: Issues #146, #147, #148, #149, #150, #151

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

## Dependency graph

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
